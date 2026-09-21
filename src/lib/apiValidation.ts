import type {
  DailyReviewCategoryCount, DailyReviewStatus, Knowledge, KnowledgePriority, Mastery, QuizEmptyReason, QuizFormat,
  QuizGradeFailure, QuizGradeFailurePhase, QuizGradeResponse, QuizGradeResult, QuizLog, QuizQuestion,
  QuizStart, QuizVerdict, RecoveryPreview,
  RelearningStage, SpeakingPracticeLog, SpeakingPracticeRating, SpeakingPracticeType,
} from "../types";

interface PageEnvelope {
  items: unknown[];
  total: number | null;
  limit: number;
  offset: number;
}

const MASTERY_VALUES = new Set<Mastery>(["未学習", "学習中", "習得中", "定着"]);
const PRIORITY_VALUES = new Set<KnowledgePriority>(["最高", "高", "中", "低", "最低"]);
const VERDICT_VALUES = new Set<QuizVerdict>(["正解", "不正解", "部分正解"]);
const QUIZ_FORMAT_VALUES = new Set<QuizFormat>(["一問一答", "四択", "記述説明", "産出"]);
const RELEARNING_STAGE_VALUES = new Set<RelearningStage>(["recognition", "recall"]);
const GRADE_FAILURE_PHASE_VALUES = new Set<QuizGradeFailurePhase>([
  "verification", "grading", "recording", "confirmation",
]);
const SPEAKING_PRACTICE_TYPE_VALUES = new Set<SpeakingPracticeType>([
  "instant_composition", "read_aloud",
]);
const SPEAKING_PRACTICE_RATING_VALUES = new Set<SpeakingPracticeRating>([
  "smooth", "almost", "retry",
]);

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
  const priority = stringValue(value, "priority", entity);
  if (!PRIORITY_VALUES.has(priority as KnowledgePriority)) return fail(entity, "priority");
  if (typeof value.archived !== "boolean") return fail(entity, "archived");
  const contentVersion = numberValue(value, "content_version", entity);
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 1) return fail(entity, "content_version");
  const relearningStage = nullableStringValue(value, "relearning_stage", entity);
  if (relearningStage !== null && !RELEARNING_STAGE_VALUES.has(relearningStage as RelearningStage)) {
    return fail(entity, "relearning_stage");
  }
  return {
    id: stringValue(value, "id", entity),
    title: stringValue(value, "title", entity),
    explanation: nullableStringValue(value, "explanation", entity),
    source_note: nullableStringValue(value, "source_note", entity),
    category: stringValue(value, "category", entity),
    mastery: mastery as Mastery,
    priority: priority as KnowledgePriority,
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
    next_review_at: stringValue(value, "next_review_at", entity),
    stability_hours: numberValue(value, "stability_hours", entity),
    relearning_stage: relearningStage as RelearningStage | null,
    last_reviewed_at: nullableStringValue(value, "last_reviewed_at", entity),
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

function nonNegativeInteger(record: Record<string, unknown>, field: string, entity: string): number {
  const value = numberValue(record, field, entity);
  if (!Number.isSafeInteger(value) || value < 0) return fail(entity, field);
  return value;
}

function categoryCountsValue(
  record: Record<string, unknown>,
  field: string,
  entity: string,
): DailyReviewCategoryCount[] {
  const value = record[field];
  if (!Array.isArray(value)) return fail(entity, field);
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) return fail(entity, field);
    const category = stringValue(item, "category", entity);
    const count = nonNegativeInteger(item, "count", entity);
    if (!category.trim() || seen.has(category)) return fail(entity, field);
    seen.add(category);
    return { category, count };
  });
}

export function parseDailyReviewStatus(value: unknown): DailyReviewStatus {
  const entity = "日次復習キュー";
  if (!isRecord(value)) return fail(entity);
  const result = {
    review_on: stringValue(value, "review_on", entity),
    limit: nonNegativeInteger(value, "limit", entity),
    total: nonNegativeInteger(value, "total", entity),
    completed: nonNegativeInteger(value, "completed", entity),
    completed_unique: nonNegativeInteger(value, "completed_unique", entity),
    remaining: nonNegativeInteger(value, "remaining", entity),
    due_total: nonNegativeInteger(value, "due_total", entity),
    overdue_total: nonNegativeInteger(value, "overdue_total", entity),
    retry_ready: nonNegativeInteger(value, "retry_ready", entity),
    retry_waiting: nonNegativeInteger(value, "retry_waiting", entity),
    next_retry_at: nullableStringValue(value, "next_retry_at", entity),
    remaining_by_category: categoryCountsValue(value, "remaining_by_category", entity),
  };
  const categoryTotal = result.remaining_by_category.reduce((sum, item) => sum + item.count, 0);
  if (
    result.limit < 1 || result.limit > 30
    || result.completed + result.remaining !== result.total
    || categoryTotal !== result.remaining
  ) {
    return fail(entity);
  }
  return result;
}

export function parseRecoveryPreview(value: unknown): RecoveryPreview {
  const entity = "回復プレビュー";
  if (!isRecord(value) || !Array.isArray(value.days) || !Array.isArray(value.sample)) return fail(entity);
  const total = nonNegativeInteger(value, "total", entity);
  const dailyLimit = nonNegativeInteger(value, "daily_limit", entity);
  const from = nullableStringValue(value, "from", entity);
  const through = nullableStringValue(value, "through", entity);
  const token = stringValue(value, "token", entity);
  if (dailyLimit < 1 || dailyLimit > 30 || (total > 0 && token.length < 20) || (total === 0 && token !== "")) {
    return fail(entity);
  }
  const days = value.days.map((item) => {
    if (!isRecord(item)) return fail(entity, "days");
    return { date: stringValue(item, "date", entity), count: nonNegativeInteger(item, "count", entity) };
  });
  const sample = value.sample.map((item) => {
    if (!isRecord(item)) return fail(entity, "sample");
    const priority = stringValue(item, "priority", entity);
    if (!PRIORITY_VALUES.has(priority as KnowledgePriority)) return fail(entity, "priority");
    return {
      id: stringValue(item, "id", entity),
      title: stringValue(item, "title", entity),
      priority: priority as KnowledgePriority,
      accuracy: nullableNumberValue(item, "accuracy", entity),
      overdue_days: nonNegativeInteger(item, "overdue_days", entity),
      current_next_review_on: stringValue(item, "current_next_review_on", entity),
      scheduled_on: stringValue(item, "scheduled_on", entity),
    };
  });
  return { total, daily_limit: dailyLimit, from, through, days, sample, token };
}

export function parseQuizGradeResult(value: unknown): QuizGradeResult {
  const entity = "採点結果";
  if (!isRecord(value)) return fail(entity);
  const verdict = stringValue(value, "verdict", entity);
  if (!VERDICT_VALUES.has(verdict as QuizVerdict)) return fail(entity, "verdict");
  const priority = stringValue(value, "priority", entity);
  if (!PRIORITY_VALUES.has(priority as KnowledgePriority)) return fail(entity, "priority");
  const contentVersion = numberValue(value, "content_version", entity);
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 1) {
    return fail(entity, "content_version");
  }
  if (typeof value.recorded !== "boolean") return fail(entity, "recorded");
  if (typeof value.schedule_updated !== "boolean") return fail(entity, "schedule_updated");
  const relearningStage = nullableStringValue(value, "relearning_stage", entity);
  if (relearningStage !== null && !RELEARNING_STAGE_VALUES.has(relearningStage as RelearningStage)) {
    return fail(entity, "relearning_stage");
  }
  return {
    id: stringValue(value, "id", entity),
    title: stringValue(value, "title", entity),
    category: stringValue(value, "category", entity),
    priority: priority as KnowledgePriority,
    content_version: contentVersion,
    verdict: verdict as QuizVerdict,
    quality: (() => {
      const quality = numberValue(value, "quality", entity);
      if (!Number.isInteger(quality) || quality < 0 || quality > 5) return fail(entity, "quality");
      return quality;
    })(),
    correct_answer: stringValue(value, "correct_answer", entity),
    explanation: stringValue(value, "explanation", entity),
    next_review_on: nullableStringValue(value, "next_review_on", entity),
    next_review_at: stringValue(value, "next_review_at", entity),
    stability_hours: numberValue(value, "stability_hours", entity),
    relearning_stage: relearningStage as RelearningStage | null,
    schedule_updated: value.schedule_updated,
    recorded: value.recorded,
  };
}

function parseQuizGradeFailure(value: unknown): QuizGradeFailure {
  const entity = "採点エラー";
  if (!isRecord(value)) return fail(entity);
  const index = numberValue(value, "index", entity);
  if (!Number.isSafeInteger(index) || index < 0) return fail(entity, "index");
  const id = nullableStringValue(value, "id", entity);
  const phase = stringValue(value, "phase", entity);
  if (!GRADE_FAILURE_PHASE_VALUES.has(phase as QuizGradeFailurePhase)) return fail(entity, "phase");
  if (value.recorded !== null && typeof value.recorded !== "boolean") return fail(entity, "recorded");
  return {
    index,
    id,
    phase: phase as QuizGradeFailurePhase,
    error: stringValue(value, "error", entity),
    recorded: value.recorded as boolean | null,
  };
}

export function parseQuizGradeResponse(value: unknown): QuizGradeResponse {
  const entity = "採点応答";
  if (!isRecord(value) || !Array.isArray(value.results) || !Array.isArray(value.failures)) {
    return fail(entity);
  }
  const results = value.results.map(parseQuizGradeResult);
  const failures = value.failures.map(parseQuizGradeFailure);
  if (new Set(failures.map((failure) => failure.index)).size !== failures.length) {
    return fail(entity, "failures");
  }
  return { results, failures };
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

export function parseSpeakingPracticeLog(value: unknown): SpeakingPracticeLog {
  const entity = "英会話練習履歴";
  if (!isRecord(value)) return fail(entity);
  const type = stringValue(value, "practice_type", entity);
  const rating = stringValue(value, "rating", entity);
  if (!SPEAKING_PRACTICE_TYPE_VALUES.has(type as SpeakingPracticeType)) {
    return fail(entity, "practice_type");
  }
  if (!SPEAKING_PRACTICE_RATING_VALUES.has(rating as SpeakingPracticeRating)) {
    return fail(entity, "rating");
  }
  const id = numberValue(value, "id", entity);
  const repetitions = numberValue(value, "repetitions", entity);
  if (!Number.isSafeInteger(id) || id < 1) return fail(entity, "id");
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20) {
    return fail(entity, "repetitions");
  }
  return {
    id,
    attempt_id: stringValue(value, "attempt_id", entity),
    session_id: stringValue(value, "session_id", entity),
    knowledge_id: stringValue(value, "knowledge_id", entity),
    practice_type: type as SpeakingPracticeType,
    rating: rating as SpeakingPracticeRating,
    answer_text: nullableStringValue(value, "answer_text", entity),
    repetitions,
    practiced_at: stringValue(value, "practiced_at", entity),
  };
}
