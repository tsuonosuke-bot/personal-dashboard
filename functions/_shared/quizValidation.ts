export const QUIZ_ACTION_HEADER = "quiz-session";
export const MAX_QUIZ_REQUEST_CHARS = 160_000;

export const MIN_QUIZ_LIMIT = 1;
export const MAX_QUIZ_LIMIT = 30;
export const DEFAULT_QUIZ_LIMIT = 15;
export const MAX_ANSWER_CHARS = 2_000;
export const MAX_QUESTION_CHARS = 2_000;
export const MAX_CHOICE_CHARS = 500;
export const MAX_QUIZ_TOKEN_CHARS = 16_000;
export const MAX_QUIZ_CATEGORIES = 50;
export const MAX_CATEGORY_CHARS = 100;
export const MAX_EXCLUDE_IDS = 60;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
  /** dailyは当日固定キュー、customは従来のカテゴリ指定出題。 */
  mode: "daily" | "custom";
  /** バックグラウンドで採点中の項目。記録前に同じ項目を二重に出題しない。 */
  excludeIds: string[];
}

export interface GradeAnswerInput {
  token: string;
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

  const rawMode = "mode" in input ? input.mode : "custom";
  if (rawMode !== "daily" && rawMode !== "custom") {
    return { ok: false, error: "modeはdailyまたはcustomを指定してください。" };
  }
  if (rawMode === "daily" && categories.length > 0) {
    return { ok: false, error: "今日の復習キューではカテゴリを指定できません。" };
  }

  const rawExclude = "excludeIds" in input ? input.excludeIds : [];
  if (!Array.isArray(rawExclude) || rawExclude.length > MAX_EXCLUDE_IDS) {
    return { ok: false, error: `除外する項目は${MAX_EXCLUDE_IDS}件以内の配列で指定してください。` };
  }
  const excludeIds: string[] = [];
  for (const raw of rawExclude) {
    if (typeof raw !== "string" || !isUuid(raw)) return { ok: false, error: "除外する項目のIDが正しくありません。" };
    const value = raw.toLowerCase();
    if (!excludeIds.includes(value)) excludeIds.push(value);
  }

  return { ok: true, value: { categories, limit: rawLimit, format: rawFormat, mode: rawMode, excludeIds } };
}

export function validateGradeRequest(
  input: unknown,
): { ok: true; value: GradeAnswerInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_QUIZ_LIMIT) {
    return { ok: false, error: `回答は1〜${MAX_QUIZ_LIMIT}件で送信してください。` };
  }
  const result: GradeAnswerInput[] = [];
  for (const entry of input) {
    if (!isPlainObject(entry)) return { ok: false, error: "回答の形式が正しくありません。" };
    const keys = Object.keys(entry);
    if (keys.some((key) => key !== "token" && key !== "answer")) {
      return { ok: false, error: "回答に許可されていない項目が含まれています。" };
    }
    const { token, answer } = entry;
    if (typeof token !== "string" || token.length < 20 || token.length > MAX_QUIZ_TOKEN_CHARS) {
      return { ok: false, error: "クイズトークンが正しくありません。" };
    }
    if (typeof answer !== "string" || answer.length > MAX_ANSWER_CHARS) {
      return { ok: false, error: `回答は${MAX_ANSWER_CHARS}文字以内の文字列で入力してください。` };
    }
    result.push({ token, answer: answer.trim() });
  }
  return { ok: true, value: result };
}
