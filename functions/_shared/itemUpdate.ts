import { DashboardError, type DashboardEnv } from "./dashboard.ts";

const MAX_REQUEST_CHARS = 8_000;
const MAX_CONTENT_CHARS = 2_000;

export interface ItemUpdateDefinition {
  table: "wants";
  actionHeader: "want-update";
  allowedStatuses: ReadonlySet<string>;
  select: string;
  conflictCode: "WANT_UPDATE_CONFLICT";
}

export const WANT_UPDATE: ItemUpdateDefinition = {
  table: "wants",
  actionHeader: "want-update",
  allowedStatuses: new Set(["active", "completed", "dropped"]),
  select: "id,content,status,created_at",
  conflictCode: "WANT_UPDATE_CONFLICT",
};

interface ItemSnapshot {
  content: string;
  status: string;
}

export interface ItemUpdateInput {
  id: number;
  content: string;
  status: string;
  original: ItemSnapshot;
}

type ValidationResult =
  | { ok: true; value: ItemUpdateInput }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function validSnapshot(value: unknown): value is ItemSnapshot {
  return isPlainObject(value)
    && hasOnlyKeys(value, ["content", "status"])
    && typeof value.content === "string"
    && value.content.length <= MAX_CONTENT_CHARS
    && typeof value.status === "string"
    && /^[a-z][a-z0-9_-]{0,63}$/.test(value.status);
}

export function validateItemUpdateRequest(
  request: Request,
  definition: ItemUpdateDefinition,
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

export async function readItemUpdateInput(
  request: Request,
  definition: ItemUpdateDefinition,
): Promise<ValidationResult> {
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
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "content", "status", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) {
    return { ok: false, status: 400, error: "IDが正しくありません。" };
  }
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return { ok: false, status: 400, error: "内容を入力してください。" };
  }
  const content = value.content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    return { ok: false, status: 400, error: `内容は${MAX_CONTENT_CHARS}文字以内で入力してください。` };
  }
  if (typeof value.status !== "string" || !definition.allowedStatuses.has(value.status)) {
    return { ok: false, status: 400, error: "ステータスが正しくありません。" };
  }
  if (!validSnapshot(value.original)) {
    return { ok: false, status: 400, error: "編集前の情報が正しくありません。" };
  }

  return {
    ok: true,
    value: {
      id: Number(value.id),
      content,
      status: value.status,
      original: value.original,
    },
  };
}

export async function updateItem(
  env: DashboardEnv,
  definition: ItemUpdateDefinition,
  input: ItemUpdateInput,
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

  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("content", `eq.${input.original.content}`);
  endpoint.searchParams.set("status", `eq.${input.original.status}`);
  endpoint.searchParams.set("select", definition.select);

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
      body: JSON.stringify({ content: input.content, status: input.status }),
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
  if (!Array.isArray(rows)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${definition.table} returned invalid data.`);
  }
  if (rows.length === 0) {
    throw new DashboardError(definition.conflictCode, `${definition.table} changed before this update.`, 409);
  }
  if (rows.length !== 1) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${definition.table} updated an unexpected number of rows.`);
  }
  return rows[0];
}
