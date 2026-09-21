import { DashboardError, type DashboardEnv } from "./dashboard.ts";

const MAX_REQUEST_CHARS = 5_000;
const MAX_CONTENT_CHARS = 2_000;
const MAX_NOTE_CHARS = 2_000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1_000;

export interface ItemCreateDefinition {
  table: "wants";
  actionHeader: "want-create";
  select: string;
  status: "active";
  type: "want";
}

export const WANT_CREATE: ItemCreateDefinition = {
  table: "wants",
  actionHeader: "want-create",
  select: "id,content,status,type,revisit_on,note,source_inbox_id,created_at",
  status: "active",
  type: "want",
};

export interface ItemCreateInput {
  content: string;
  revisitOn: string | null;
  note: string | null;
  sourceInboxId: number | null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function todayInTokyo(): string {
  return new Date(Date.now() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

type ValidationResult =
  | { ok: true; value: ItemCreateInput }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateItemCreateRequest(
  request: Request,
  definition: ItemCreateDefinition,
): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return { status: 403, error: "許可されていない送信元です。" };
  }
  if (request.headers.get("X-Dashboard-Action") !== definition.actionHeader) {
    return { status: 403, error: "登録用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readItemCreateInput(request: Request): Promise<ValidationResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) {
    return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  if (!isPlainObject(value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const optionalKeys = ["revisitOn", "note", "sourceInboxId"];
  if (Object.keys(value).some((key) => key !== "content" && !optionalKeys.includes(key)) || !("content" in value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return { ok: false, status: 400, error: "内容を入力してください。" };
  }
  const content = value.content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    return { ok: false, status: 400, error: `内容は${MAX_CONTENT_CHARS}文字以内で入力してください。` };
  }

  let revisitOn: string | null = null;
  if ("revisitOn" in value && value.revisitOn !== null) {
    if (typeof value.revisitOn !== "string" || !isCalendarDate(value.revisitOn)) {
      return { ok: false, status: 400, error: "再訪日はYYYY-MM-DD形式で入力してください。" };
    }
    if (value.revisitOn < todayInTokyo()) {
      return { ok: false, status: 400, error: "再訪日は今日以降の日付を指定してください。" };
    }
    revisitOn = value.revisitOn;
  }

  let note: string | null = null;
  if ("note" in value && value.note !== null) {
    if (typeof value.note !== "string") {
      return { ok: false, status: 400, error: "メモが正しくありません。" };
    }
    const trimmed = value.note.trim();
    if (trimmed.length > MAX_NOTE_CHARS) {
      return { ok: false, status: 400, error: `メモは${MAX_NOTE_CHARS}文字以内で入力してください。` };
    }
    note = trimmed || null;
  }

  let sourceInboxId: number | null = null;
  if ("sourceInboxId" in value && value.sourceInboxId !== null) {
    if (!Number.isSafeInteger(value.sourceInboxId) || Number(value.sourceInboxId) <= 0) {
      return { ok: false, status: 400, error: "元のInbox IDが正しくありません。" };
    }
    sourceInboxId = Number(value.sourceInboxId);
  }

  return { ok: true, value: { content, revisitOn, note, sourceInboxId } };
}

export async function insertItem(
  env: DashboardEnv,
  definition: ItemCreateDefinition,
  input: ItemCreateInput,
): Promise<unknown> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);

  let endpoint: URL;
  try {
    endpoint = new URL(`/rest/v1/${definition.table}`, rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (endpoint.protocol !== "https:") {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  }
  endpoint.searchParams.set("select", definition.select);

  const payload: Record<string, string | number> = {
    content: input.content,
    status: definition.status,
    type: definition.type,
  };
  if (input.revisitOn) payload.revisit_on = input.revisitOn;
  if (input.note) payload.note = input.note;
  if (input.sourceInboxId) payload.source_inbox_id = input.sourceInboxId;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
        apikey: key,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", `Could not reach ${definition.table}.`);
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "SUPABASE_ACCESS_DENIED"
      : "SUPABASE_REQUEST_FAILED";
    throw new DashboardError(code, `${definition.table} returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${definition.table} returned invalid data.`);
  }
  return rows[0];
}
