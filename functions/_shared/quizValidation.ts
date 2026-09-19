export const QUIZ_ACTION_HEADER = "quiz-session";
export const MAX_QUIZ_REQUEST_CHARS = 40_000;

export type QuizMode = "english" | "non_english" | "all";
const QUIZ_MODES: readonly QuizMode[] = ["english", "non_english", "all"];

export const MIN_QUIZ_LIMIT = 1;
export const MAX_QUIZ_LIMIT = 30;
export const DEFAULT_QUIZ_LIMIT = 15;
export const MAX_ANSWER_CHARS = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestGuardError {
  status: number;
  error: string;
}

export interface StartRequestInput {
  mode: QuizMode;
  limit: number;
}

export interface GradeAnswerInput {
  id: string;
  answer: string;
}

type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** knowledge書き込みAPIと同じCSRFガード（同一オリジン・専用ヘッダー・JSON・文字数上限）をクイズ用に適用する。 */
export function validateQuizRequest(request: Request): RequestGuardError | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return { status: 403, error: "許可されていない送信元です。" };
  }
  if (request.headers.get("X-Dashboard-Action") !== QUIZ_ACTION_HEADER) {
    return { status: 403, error: "クイズ用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUIZ_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readQuizJsonBody(request: Request): Promise<JsonResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "リクエストを読み取れませんでした。" };
  }
  if (text.length > MAX_QUIZ_REQUEST_CHARS) {
    return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
}

export function validateStartRequest(
  input: unknown,
): { ok: true; value: StartRequestInput } | { ok: false; error: string } {
  if (!isPlainObject(input)) return { ok: false, error: "入力内容の形式が正しくありません。" };

  const rawMode = "mode" in input ? input.mode : "all";
  if (typeof rawMode !== "string" || !QUIZ_MODES.includes(rawMode as QuizMode)) {
    return { ok: false, error: "modeが正しくありません。" };
  }

  const rawLimit = "limit" in input ? input.limit : DEFAULT_QUIZ_LIMIT;
  if (
    typeof rawLimit !== "number" || !Number.isInteger(rawLimit)
    || rawLimit < MIN_QUIZ_LIMIT || rawLimit > MAX_QUIZ_LIMIT
  ) {
    return { ok: false, error: `limitは${MIN_QUIZ_LIMIT}〜${MAX_QUIZ_LIMIT}の整数で指定してください。` };
  }

  return { ok: true, value: { mode: rawMode as QuizMode, limit: rawLimit } };
}

export function validateGradeRequest(
  input: unknown,
): { ok: true; value: GradeAnswerInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_QUIZ_LIMIT) {
    return { ok: false, error: `回答は1〜${MAX_QUIZ_LIMIT}件で送信してください。` };
  }
  const seen = new Set<string>();
  const result: GradeAnswerInput[] = [];
  for (const entry of input) {
    if (!isPlainObject(entry)) return { ok: false, error: "回答の形式が正しくありません。" };
    const { id, answer } = entry;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return { ok: false, error: "回答のIDが正しくありません。" };
    }
    if (seen.has(id)) return { ok: false, error: "同じ問題への回答が重複しています。" };
    seen.add(id);
    if (typeof answer !== "string" || answer.length > MAX_ANSWER_CHARS) {
      return { ok: false, error: `回答は${MAX_ANSWER_CHARS}文字以内の文字列で入力してください。` };
    }
    result.push({ id, answer: answer.trim() });
  }
  return { ok: true, value: result };
}
