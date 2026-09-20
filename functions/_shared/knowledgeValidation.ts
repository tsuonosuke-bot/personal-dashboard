export const KNOWLEDGE_ACTION_HEADER = "knowledge-write";
export const MAX_REQUEST_CHARS = 25_000;

export const MASTERY_VALUES = ["未学習", "学習中", "習得中", "定着"] as const;
type MasteryValue = (typeof MASTERY_VALUES)[number];

export interface KnowledgeWriteInput {
  title?: string;
  explanation?: string | null;
  source_note?: string | null;
  category?: string;
  mastery?: MasteryValue;
  tags?: string[];
  next_review_on?: string | null;
  archived?: boolean;
}

type ValidationResult =
  | { ok: true; value: KnowledgeWriteInput }
  | { ok: false; error: string };

type UpdateValidationResult =
  | { ok: true; expectedVersion: number; changes: KnowledgeWriteInput }
  | { ok: false; error: string };

type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

export interface RequestGuardError {
  status: number;
  error: string;
}

const EDITABLE_KEYS = new Set([
  "title", "explanation", "source_note", "category", "mastery",
  "tags", "next_review_on", "archived",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${label}は必須です。` };
  }
  const text = value.trim();
  if (text.length > maxLength) {
    return { ok: false, error: `${label}は${maxLength}文字以内で入力してください。` };
  }
  return { ok: true, value: text };
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: `${label}の形式が正しくありません。` };
  }
  const text = value.trim();
  if (text.length > maxLength) {
    return { ok: false, error: `${label}は${maxLength}文字以内で入力してください。` };
  }
  return { ok: true, value: text || null };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateMutationRequest(request: Request): RequestGuardError | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }

  if (request.headers.get("Origin") !== expectedOrigin) {
    return { status: 403, error: "許可されていない送信元です。" };
  }
  if (request.headers.get("X-Dashboard-Action") !== KNOWLEDGE_ACTION_HEADER) {
    return { status: 403, error: "更新用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readJsonBody(request: Request): Promise<JsonResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "リクエストを読み取れませんでした。" };
  }
  if (text.length > MAX_REQUEST_CHARS) {
    return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
}

export function validateKnowledgeInput(
  input: unknown,
  mode: "create" | "update",
): ValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "入力内容の形式が正しくありません。" };
  }

  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, error: "更新項目がありません。" };
  const unknownKey = keys.find((key) => !EDITABLE_KEYS.has(key));
  if (unknownKey) return { ok: false, error: `編集できない項目が含まれています: ${unknownKey}` };
  if (mode === "create" && "archived" in input) {
    return { ok: false, error: "新規登録時にアーカイブ状態は指定できません。" };
  }

  const result: KnowledgeWriteInput = {};
  if (mode === "create" || "title" in input) {
    const parsed = requiredText(input.title, "タイトル", 200);
    if (!parsed.ok) return parsed;
    result.title = parsed.value;
  }
  if (mode === "create" || "category" in input) {
    const parsed = requiredText(input.category, "カテゴリ", 100);
    if (!parsed.ok) return parsed;
    result.category = parsed.value;
  }
  if ("explanation" in input) {
    const parsed = optionalText(input.explanation, "説明", 10_000);
    if (!parsed.ok) return parsed;
    result.explanation = parsed.value;
  }
  if ("source_note" in input) {
    const parsed = optionalText(input.source_note, "出典メモ", 5_000);
    if (!parsed.ok) return parsed;
    result.source_note = parsed.value;
  }
  if ("mastery" in input) {
    if (typeof input.mastery !== "string" || !(MASTERY_VALUES as readonly string[]).includes(input.mastery)) {
      return { ok: false, error: "習熟度が正しくありません。" };
    }
    result.mastery = input.mastery as MasteryValue;
  }
  if ("tags" in input) {
    if (!Array.isArray(input.tags) || input.tags.length > 30) {
      return { ok: false, error: "タグは30件以内で指定してください。" };
    }
    const tags: string[] = [];
    for (const value of input.tags) {
      if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 50) {
        return { ok: false, error: "各タグは1〜50文字で入力してください。" };
      }
      const tag = value.trim();
      if (!tags.includes(tag)) tags.push(tag);
    }
    result.tags = tags;
  }
  if ("next_review_on" in input) {
    if (input.next_review_on === null || input.next_review_on === "") {
      result.next_review_on = null;
    } else if (typeof input.next_review_on !== "string" || !validDate(input.next_review_on)) {
      return { ok: false, error: "次回復習日はYYYY-MM-DD形式で入力してください。" };
    } else {
      result.next_review_on = input.next_review_on;
    }
  }
  if ("archived" in input) {
    if (typeof input.archived !== "boolean") {
      return { ok: false, error: "アーカイブ状態が正しくありません。" };
    }
    result.archived = input.archived;
  }
  return { ok: true, value: result };
}

/** 更新要求は変更内容と、画面が読み込んだ時点のバージョンを必ず組にする。 */
export function validateKnowledgeUpdateEnvelope(input: unknown): UpdateValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "入力内容の形式が正しくありません。" };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "expected_version" && key !== "changes")) {
    return { ok: false, error: "更新要求に許可されていない項目が含まれています。" };
  }
  if (
    typeof input.expected_version !== "number"
    || !Number.isSafeInteger(input.expected_version)
    || input.expected_version < 1
  ) {
    return { ok: false, error: "更新バージョンが正しくありません。" };
  }
  const changes = validateKnowledgeInput(input.changes, "update");
  if (!changes.ok) return changes;
  return { ok: true, expectedVersion: input.expected_version, changes: changes.value };
}
