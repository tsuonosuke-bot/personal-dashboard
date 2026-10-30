import { isUuid } from "./knowledgeValidation.ts";

export const INSIGHT_ACTION_HEADER = "knowledge-insight";
export const MAX_INSIGHT_CHARS = 1_000;
const MAX_REQUEST_CHARS = 4_000;

export const INSIGHT_SELECT = "id,knowledge_id,body,created_at,updated_at";

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function validateInsightRequest(request: Request, withBody = true): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== INSIGHT_ACTION_HEADER) {
    return { status: 403, error: "示唆の更新用ヘッダーがありません。" };
  }
  if (!withBody) return null;
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

async function readObject(request: Request, keys: string[]): Promise<Result<Record<string, unknown>>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "リクエストを読み取れませんでした。" };
  }
  if (text.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  return { ok: true, value: record };
}

function readBody(value: unknown): Result<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, status: 400, error: "示唆を入力してください。" };
  }
  const body = value.trim();
  if (body.length > MAX_INSIGHT_CHARS) {
    return { ok: false, status: 400, error: `示唆は${MAX_INSIGHT_CHARS}文字以内で入力してください。` };
  }
  return { ok: true, value: body };
}

export async function readInsightCreate(request: Request): Promise<Result<{ knowledgeId: string; body: string }>> {
  const parsed = await readObject(request, ["knowledge_id", "body"]);
  if (!parsed.ok) return parsed;
  const { knowledge_id: knowledgeId, body } = parsed.value;
  if (typeof knowledgeId !== "string" || !isUuid(knowledgeId)) {
    return { ok: false, status: 400, error: "ナレッジIDが正しくありません。" };
  }
  const text = readBody(body);
  if (!text.ok) return text;
  return { ok: true, value: { knowledgeId: knowledgeId.toLowerCase(), body: text.value } };
}

export async function readInsightUpdate(request: Request): Promise<Result<{ body: string; expectedUpdatedAt: string }>> {
  const parsed = await readObject(request, ["body", "expected_updated_at"]);
  if (!parsed.ok) return parsed;
  const { body, expected_updated_at: expected } = parsed.value;
  if (typeof expected !== "string" || Number.isNaN(Date.parse(expected))) {
    return { ok: false, status: 400, error: "更新前の示唆の情報が正しくありません。" };
  }
  const text = readBody(body);
  if (!text.ok) return text;
  return { ok: true, value: { body: text.value, expectedUpdatedAt: expected } };
}

export function readInsightId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
