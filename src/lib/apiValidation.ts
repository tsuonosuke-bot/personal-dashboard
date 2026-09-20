import type {
  Knowledge, Mastery, QuizEmptyReason, QuizFormat, QuizGradeResult, QuizLog,
  QuizQuestion, QuizStart, QuizVerdict,
} from "../types";

interface PageEnvelope {
  items: unknown[];
  total: number | null;
  limit: number;
  offset: number;
}

const MASTERY_VALUES = new Set<Mastery>(["未学習", "学習中", "習得中", "定着"]);
const VERDICT_VALUES = new Set<QuizVerdict>(["正解", "不正解", "部分正解"]);
const QUIZ_FORMAT_VALUES = new Set<QuizFormat>(["一問一答", "四択", "記述説明", "産出"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(entity: string, field?: string): never {
  throw new Error(`APIから受信した${entity}${field ? `の${field}` : ""}が正しくありません。`);
}

function stringValue(record: Record<string, unknown>, field: string, entity: string): string {
  const value = record[field];
  if (typeof value !== "string") return fail(entity, field);
  return value;
}

function nullableStringValue(
  record: Record<string, unknown>,
  field: string,
  entity: string,
): string | null {
  const value = record[field];
  if (value !== null && typeof value !== "string") return fail(entity, field);
  return value;
}

function numberValue(record: Record<string, unknown>, field: string, entity: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(entity, field);
  return value;
}

function nullableNumberValue(
  record: Record<string, unknown>,
  field: string,
  entity: string,
): number | null {
  const value = record[field];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    return fail(entity, field);
  }
  return value;
}

function stringArrayValue(record: Record<string, unknown>, field: string, entity: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return fail(entity, field);
  }
  return value;
}

export function parsePageEnvelope(value: unknown): PageEnvelope {
  if (!isRecord(value) || !Array.isArray(value.items)) return fail("ページ応答");
  const { total, limit, offset } = value;
  if (total !== null && (!Number.isSafeInteger(total) || (total as number) < 0)) {
    return fail("ページ応答", "total");
  }
  if (!Number.isSafeInteger(limit) || (limit as number) < 1) return fail("ページ応答", "limit");
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) return fail("ページ応答", "offset");
  return {
    items: value.items,
    total: total as number | null,
    limit: limit as number,
    offset: offset as number,
  };
}

export function parseKnowledge(value: unknown): Knowledge {
  const entity = "ナレッジ";
  if (!isRecord(value)) return fail(entity);
  const mastery = stringValue(value, "mastery", entity);
  if (!MASTERY_VALUES.has(mastery as Mastery)) return fail(entity, "mastery");
  if (typeof value.archived !== "boolean") return fail(entity, "archived");
  const contentVersion = numberValue(value, "content_version", entity);
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 1) return fail(entity, "content_version");
  return {
    id: stringValue(value, "id", entity),
    title: stringValue(value, "title", entity),
    explanation: nullableStringValue(value, "explanation", entity),
    source_note: nullableStringValue(value, "source_note", entity),
    category: stringValue(value, "category", entity),
    mastery: mastery as Mastery,
    ef: numberValue(value, "ef", entity),
    reps: numberValue(value, "reps", entity),
    interval_days: numberValue(value, "interval_days", entity),
    times_asked: numberValue(value, "times_asked", entity),
    times_correct: numberValue(value, "times_correct", entity),
    learned_on: stringValue(value, "learned_on", entity),
    last_asked_on: nullableStringValue(value, "last_asked_on", entity),
    tags: stringArrayValue(value, "tags", entity),
    accuracy: nullableNumberValue(value, "accuracy", entity),
    next_review_on: nullableStringValue(value, "next_review_on", entity),
    mastery_streak: numberValue(value, "mastery_streak", entity),
    archived: value.archived,
    created_at: stringValue(value, "created_at", entity),
    content_version: contentVersion,
  };
}

export function parseQuizQuestion(value: unknown): QuizQuestion {
  const entity = "出題";
  if (!isRecord(value)) return fail(entity);
  const format = stringValue(value, "format", entity);
  const token = stringValue(value, "token", entity);
  if (!QUIZ_FORMAT_VALUES.has(format as QuizFormat)) return fail(entity, "format");
  if (token.length < 20 || token.length > 16_000) return fail(entity, "token");
  const choices = value.choices === null || value.choices === undefined
    ? null
    : stringArrayValue(value, "choices", entity);
  // 四択は選択肢がないと回答できないため、形式と選択肢の食い違いを通さない。
  if (
    (format === "四択") !== (choices !== null)
    || (choices !== null && (choices.length !== 4 || new Set(choices).size !== choices.length || choices.some((choice) => !choice)))
  ) {
    return fail(entity, "choices");
  }
  return {
    id: stringValue(value, "id", entity),
    question: stringValue(value, "question", entity),
    format: format as QuizFormat,
    choices,
    token,
  };
}

export function parseQuizStartResponse(value: unknown): QuizStart {
  const entity = "出題応答";
  if (!isRecord(value) || !Array.isArray(value.items)) return fail(entity);
  const { reason } = value;
  if (reason !== undefined && reason !== "no_knowledge" && reason !== "done_today") {
    return fail(entity, "reason");
  }
  return {
    items: value.items.map(parseQuizQuestion),
    reason: (reason as QuizEmptyReason | undefined) ?? null,
    early: value.early === true,
  };
}

export function parseQuizGradeResult(value: unknown): QuizGradeResult {
  const entity = "採点結果";
  if (!isRecord(value)) return fail(entity);
  const verdict = stringValue(value, "verdict", entity);
  if (!VERDICT_VALUES.has(verdict as QuizVerdict)) return fail(entity, "verdict");
  if (typeof value.recorded !== "boolean") return fail(entity, "recorded");
  return {
    id: stringValue(value, "id", entity),
    title: stringValue(value, "title", entity),
    verdict: verdict as QuizVerdict,
    quality: (() => {
      const quality = numberValue(value, "quality", entity);
      if (!Number.isInteger(quality) || quality < 0 || quality > 5) return fail(entity, "quality");
      return quality;
    })(),
    correct_answer: stringValue(value, "correct_answer", entity),
    explanation: stringValue(value, "explanation", entity),
    next_review_on: nullableStringValue(value, "next_review_on", entity),
    recorded: value.recorded,
  };
}

export function parseQuizGradeResponse(value: unknown): QuizGradeResult[] {
  const entity = "採点応答";
  if (!isRecord(value) || !Array.isArray(value.results)) return fail(entity);
  return value.results.map(parseQuizGradeResult);
}

export function parseQuizLog(value: unknown): QuizLog {
  const entity = "クイズ履歴";
  if (!isRecord(value)) return fail(entity);
  const verdict = stringValue(value, "verdict", entity);
  if (!VERDICT_VALUES.has(verdict as QuizVerdict)) return fail(entity, "verdict");
  return {
    id: numberValue(value, "id", entity),
    knowledge_id: stringValue(value, "knowledge_id", entity),
    asked_on: stringValue(value, "asked_on", entity),
    quality: numberValue(value, "quality", entity),
    verdict: verdict as QuizVerdict,
    format: stringValue(value, "format", entity),
    note: nullableStringValue(value, "note", entity),
    created_at: stringValue(value, "created_at", entity),
  };
}
