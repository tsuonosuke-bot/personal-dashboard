import { DashboardError, type DashboardEnv } from "./dashboard.ts";

export const INBOX_UPDATE_ACTION_HEADER = "inbox-update";
const MAX_REQUEST_CHARS = 10_000;
const MAX_CONTENT_CHARS = 2_000;
const MAX_RESULT_CHARS = 2_000;
const EDITABLE_STATUSES = new Set(["pending", "done", "skipped"]);

interface InboxSnapshot {
  content: string;
  status: string;
  result: string | null;
}

export interface InboxUpdateInput {
  id: number;
  content: string;
  status: "pending" | "done" | "skipped";
  result: string | null;
  original: InboxSnapshot;
}

type ValidationResult =
  | { ok: true; value: InboxUpdateInput }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function validSnapshot(value: unknown): value is InboxSnapshot {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["content", "status", "result"])) return false;
  if (typeof value.content !== "string" || value.content.length > MAX_CONTENT_CHARS) return false;
  if (typeof value.status !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.status)) return false;
  return value.result === null || (typeof value.result === "string" && value.result.length <= MAX_RESULT_CHARS);
}

export function validateInboxUpdateRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return { status: 403, error: "許可されていない送信元です。" };
  }
  if (request.headers.get("X-Dashboard-Action") !== INBOX_UPDATE_ACTION_HEADER) {
    return { status: 403, error: "更新用ヘッダーがありません。" };
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

export async function readInboxUpdateInput(request: Request): Promise<ValidationResult> {
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
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "content", "status", "result", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) {
    return { ok: false, status: 400, error: "Inbox IDが正しくありません。" };
  }
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return { ok: false, status: 400, error: "Inboxの内容を入力してください。" };
  }
  const content = value.content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    return { ok: false, status: 400, error: `Inboxは${MAX_CONTENT_CHARS}文字以内で入力してください。` };
  }
  if (typeof value.status !== "string" || !EDITABLE_STATUSES.has(value.status)) {
    return { ok: false, status: 400, error: "ステータスが正しくありません。" };
  }
  if (value.result !== null && typeof value.result !== "string") {
    return { ok: false, status: 400, error: "整理結果が正しくありません。" };
  }
  const result = typeof value.result === "string" ? value.result.trim() || null : null;
  if (result && result.length > MAX_RESULT_CHARS) {
    return { ok: false, status: 400, error: `整理結果は${MAX_RESULT_CHARS}文字以内で入力してください。` };
  }
  if (!validSnapshot(value.original)) {
    return { ok: false, status: 400, error: "編集前のInbox情報が正しくありません。" };
  }

  return {
    ok: true,
    value: {
      id: Number(value.id),
      content,
      status: value.status as "pending" | "done" | "skipped",
      result,
      original: value.original,
    },
  };
}

export async function updateInbox(env: DashboardEnv, input: InboxUpdateInput): Promise<unknown> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);

  let endpoint: URL;
  try {
    endpoint = new URL("/rest/v1/idea_inbox", rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (endpoint.protocol !== "https:") {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  }

  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("content", `eq.${input.original.content}`);
  endpoint.searchParams.set("status", `eq.${input.original.status}`);
  endpoint.searchParams.set("result", input.original.result === null ? "is.null" : `eq.${input.original.result}`);
  endpoint.searchParams.set("select", "id,content,status,result,created_at");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
        apikey: key,
      },
      body: JSON.stringify({ content: input.content, status: input.status, result: input.result }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach idea_inbox.");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "SUPABASE_ACCESS_DENIED"
      : "SUPABASE_REQUEST_FAILED";
    throw new DashboardError(code, `idea_inbox returned ${response.status}.`);
  }

  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "idea_inbox returned invalid data.");
  }
  if (rows.length === 0) {
    throw new DashboardError("INBOX_UPDATE_CONFLICT", "Inbox changed before this update.", 409);
  }
  if (rows.length !== 1) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "idea_inbox updated an unexpected number of rows.");
  }
  return rows[0];
}
