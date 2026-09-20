export const QUIZ_ACTION_HEADER = "quiz-session";
export const MAX_QUIZ_REQUEST_CHARS = 40_000;

export const MIN_QUIZ_LIMIT = 1;
export const MAX_QUIZ_LIMIT = 30;
export const DEFAULT_QUIZ_LIMIT = 15;
export const MAX_ANSWER_CHARS = 2_000;
export const MAX_QUESTION_CHARS = 2_000;
export const MAX_QUIZ_CATEGORIES = 50;
export const MAX_CATEGORY_CHARS = 100;

/** quiz_log.format のCHECK制約で許可されている値のうち、ダッシュボードから出題できるもの。 */
export const QUIZ_FORMATS = ["一問一答", "四択", "記述説明", "産出"] as const;
export type QuizFormat = (typeof QUIZ_FORMATS)[number];

/** 出題時だけ指定できる、項目ごとに習熟度から形式を選ばせる指定。 */
export const AUTO_FORMAT = "おまかせ";
export type QuizFormatRequest = QuizFormat | typeof AUTO_FORMAT;

/** 形式未指定の古いクライアントから来た採点要求に使う既定値。 */
export const DEFAULT_QUIZ_FORMAT: QuizFormat = "一問一答";

function isQuizFormat(value: unknown): value is QuizFormat {
  return typeof value === "string" && (QUIZ_FORMATS as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestGuardError {
  status: number;
  error: string;
}

export interface StartRequestInput {
  /** 出題対象のカテゴリ。空配列は全カテゴリを意味する。 */
  categories: string[];
  limit: number;
  /** 出題形式。AUTO_FORMAT なら項目ごとに習熟度から決める。 */
  format: QuizFormatRequest;
}

export interface GradeAnswerInput {
  id: string;
  answer: string;
  format: QuizFormat;
  /** 実際に出題した問題文。採点を「この問いに答えられたか」に限定するために送り返す。 */
  question: string;
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

  const rawCategories = "categories" in input ? input.categories : [];
  if (!Array.isArray(rawCategories) || rawCategories.length > MAX_QUIZ_CATEGORIES) {
    return { ok: false, error: `カテゴリは${MAX_QUIZ_CATEGORIES}件以内の配列で指定してください。` };
  }
  const categories: string[] = [];
  for (const raw of rawCategories) {
    if (typeof raw !== "string") return { ok: false, error: "カテゴリの形式が正しくありません。" };
    const value = raw.trim();
    if (!value || value.length > MAX_CATEGORY_CHARS) {
      return { ok: false, error: `カテゴリは1〜${MAX_CATEGORY_CHARS}文字で指定してください。` };
    }
    if (!categories.includes(value)) categories.push(value);
  }

  const rawLimit = "limit" in input ? input.limit : DEFAULT_QUIZ_LIMIT;
  if (
    typeof rawLimit !== "number" || !Number.isInteger(rawLimit)
    || rawLimit < MIN_QUIZ_LIMIT || rawLimit > MAX_QUIZ_LIMIT
  ) {
    return { ok: false, error: `limitは${MIN_QUIZ_LIMIT}〜${MAX_QUIZ_LIMIT}の整数で指定してください。` };
  }

  const rawFormat = "format" in input ? input.format : AUTO_FORMAT;
  if (rawFormat !== AUTO_FORMAT && !isQuizFormat(rawFormat)) {
    return { ok: false, error: "出題形式の指定が正しくありません。" };
  }

  return { ok: true, value: { categories, limit: rawLimit, format: rawFormat } };
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
    // 形式はクイズ履歴のラベルと採点方針にしか使わないため、許可値であることだけを確かめる。
    const rawFormat = "format" in entry ? entry.format : DEFAULT_QUIZ_FORMAT;
    if (!isQuizFormat(rawFormat)) {
      return { ok: false, error: "回答の出題形式が正しくありません。" };
    }
    // 出題直後の画面から送られる想定だが、欠けていても採点自体は続けられるようにする。
    const question = "question" in entry ? entry.question : "";
    if (typeof question !== "string" || question.length > MAX_QUESTION_CHARS) {
      return { ok: false, error: `問題文は${MAX_QUESTION_CHARS}文字以内の文字列で送信してください。` };
    }
    result.push({ id, answer: answer.trim(), format: rawFormat, question: question.trim() });
  }
  return { ok: true, value: result };
}
