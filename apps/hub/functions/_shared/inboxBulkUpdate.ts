export const INBOX_BULK_UPDATE_ACTION_HEADER = "inbox-bulk-update";

const MAX_REQUEST_CHARS = 120_000;
const MAX_ITEMS = 100;
const MAX_CONTENT_CHARS = 2_000;
const MAX_RESULT_CHARS = 2_000;
const EDITABLE_STATUSES = new Set(["pending", "done", "skipped"]);

export interface InboxBulkSnapshot {
  content: string;
  status: string;
  result: string | null;
}

export interface InboxBulkItem {
  id: number;
  original: InboxBulkSnapshot;
}

export interface InboxBulkUpdateInput {
  status: "pending" | "done" | "skipped";
  items: InboxBulkItem[];
}

type ValidationResult =
  | { ok: true; value: InboxBulkUpdateInput }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function snapshot(value: unknown): InboxBulkSnapshot | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["content", "status", "result"])) return null;
  if (typeof value.content !== "string" || value.content.length === 0 || value.content.length > MAX_CONTENT_CHARS) return null;
  if (typeof value.status !== "string" || !EDITABLE_STATUSES.has(value.status)) return null;
  if (value.result !== null && (typeof value.result !== "string" || value.result.length > MAX_RESULT_CHARS)) return null;
  return { content: value.content, status: value.status, result: value.result as string | null };
}

export function validateInboxBulkUpdateRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== INBOX_BULK_UPDATE_ACTION_HEADER) {
    return { status: 403, error: "一括更新用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readInboxBulkUpdateInput(request: Request): Promise<ValidationResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["status", "items"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (typeof value.status !== "string" || !EDITABLE_STATUSES.has(value.status)) {
    return { ok: false, status: 400, error: "変更後のステータスが正しくありません。" };
  }
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
    return { ok: false, status: 400, error: `一度に変更できるInboxは1〜${MAX_ITEMS}件です。` };
  }

  const seen = new Set<number>();
  const items: InboxBulkItem[] = [];
  for (const item of value.items) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ["id", "original"]) ||
        !Number.isSafeInteger(item.id) || Number(item.id) <= 0) {
      return { ok: false, status: 400, error: "Inboxの指定が正しくありません。" };
    }
    const id = Number(item.id);
    if (seen.has(id)) return { ok: false, status: 400, error: `Inbox #${id}が重複しています。` };
    const original = snapshot(item.original);
    if (!original) return { ok: false, status: 400, error: `Inbox #${id}の更新前情報が正しくありません。` };
    seen.add(id);
    items.push({ id, original });
  }

  return {
    ok: true,
    value: { status: value.status as InboxBulkUpdateInput["status"], items },
  };
}
