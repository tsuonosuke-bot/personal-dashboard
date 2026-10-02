import { jsonResponse, requestSupabaseFunction, type SupabaseEnv } from "./supabaseRest.ts";

/** 画面から呼ぶ復習キューAPIの操作名。同一オリジンとこのヘッダーの両方を要求する。 */
export const REVIEW_QUEUE_ACTION_HEADER = "review-queue";
/** pg_cron から生成・採点バッチを呼ぶときの合言葉ヘッダー。 */
export const REVIEW_BATCH_TOKEN_HEADER = "X-Review-Batch-Token";
export const REVIEW_BATCH_PATHS = new Set(["/api/review-batch/generate", "/api/review-batch/grade"]);
const MAX_REVIEW_REQUEST_CHARS = 20_000;

export interface ReviewBatchEnv {
  REVIEW_BATCH_TOKEN?: string;
}

/** 長さの違いは漏れるが、内容の比較は定数時間で行う。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 定期実行からのバッチ呼び出しかを判定する。Basic認証を通さずに入れるのは、
 * 32文字以上の合言葉が一致した、生成・採点バッチへのPOSTだけ。
 */
export function hasReviewBatchToken(request: Request, env: ReviewBatchEnv): boolean {
  if (request.method !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return false;
  }
  if (!REVIEW_BATCH_PATHS.has(pathname)) return false;
  const expected = env.REVIEW_BATCH_TOKEN?.trim() ?? "";
  const received = request.headers.get(REVIEW_BATCH_TOKEN_HEADER) ?? "";
  return expected.length >= 32 && safeEqual(received, expected);
}

/** 画面からの書き込み要求を、同一オリジン・専用ヘッダー・JSONに限定する。 */
export function validateReviewQueueRequest(request: Request): Response | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return jsonResponse({ error: "リクエストURLが正しくありません。" }, 400);
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return jsonResponse({ error: "許可されていない送信元です。" }, 403);
  }
  if (request.headers.get("X-Dashboard-Action") !== REVIEW_QUEUE_ACTION_HEADER) {
    return jsonResponse({ error: "復習キュー用ヘッダーがありません。" }, 403);
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonResponse({ error: "JSON形式で送信してください。" }, 415);
  }
  return null;
}

export async function readReviewJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonResponse({ error: "リクエストを読み取れませんでした。" }, 400) };
  }
  if (text.length > MAX_REVIEW_REQUEST_CHARS) {
    return { ok: false, response: jsonResponse({ error: "リクエストが大きすぎます。" }, 413) };
  }
  try {
    return { ok: true, value: text.trim() ? JSON.parse(text) as unknown : {} };
  } catch {
    return { ok: false, response: jsonResponse({ error: "JSONの形式が正しくありません。" }, 400) };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readItemId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** RPCを呼び、失敗時は理由つきの例外にする。バッチ処理の中で段階ごとに扱うため。 */
export async function callRpc(env: SupabaseEnv, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await requestSupabaseFunction(env, name, args);
  if (result.ok) return result.data;
  let message = `DB処理 ${name} に失敗しました（HTTP ${result.response.status}）。`;
  try {
    const body = await result.response.clone().json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) message = `${body.error.trim()}（${name}）`;
  } catch {
    // JSONでない応答は、段階名とステータスだけを残す。
  }
  throw new Error(message);
}

/** RPCが返す1行（setof の先頭）を取り出す。 */
export function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return isRecord(data[0]) ? data[0] : null;
  return isRecord(data) ? data : null;
}
