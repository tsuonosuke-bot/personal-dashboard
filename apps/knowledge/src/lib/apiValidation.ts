import type {
  DailyReviewCategoryCount, DailyReviewStatus, InsightAnalysis, InsightGroup, InsightGroupMember, Knowledge, KnowledgeInsight, KnowledgePriority, Mastery, MasteryHistoryEvent, QuizFormat,
  QuizLog, QuizVerdict, PendingReviewAnswer, ReviewAnswerResult, ReviewBatchSummary,
  ReviewGenerationHold, ReviewQuestion, ReviewQueueStatus,
  RelearningStage, SpeakingPracticeLog, SpeakingPracticePrompt, SpeakingPracticeRating,
  SpeakingPracticeStart, SpeakingPracticeType,
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
    new_limit: nonNegativeInteger(value, "new_limit", entity),
    new_held: nonNegativeInteger(value, "new_held", entity),
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
    question: optionalString(value, "question", entity),
    user_answer: optionalString(value, "user_answer", entity),
    correct_answer: optionalString(value, "correct_answer", entity),
    explanation: optionalString(value, "explanation", entity),
    answered_at: optionalString(value, "answered_at", entity),
    confirmed_at: optionalString(value, "confirmed_at", entity),
    review_queue_id: optionalInteger(value, "review_queue_id", entity),
  };
}

/** 新しい列は古い応答に無いことがあるため、欠けていればnullとして扱う。 */
function optionalString(record: Record<string, unknown>, field: string, entity: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return fail(entity, field);
  return value;
}

function optionalInteger(record: Record<string, unknown>, field: string, entity: string): number | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) return fail(entity, field);
  return value as number;
}

function countValue(record: Record<string, unknown>, field: string, entity: string): number {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(entity, field);
  return value as number;
}

export function parseReviewQueueStatus(value: unknown): ReviewQueueStatus {
  const entity = "復習キュー";
  if (!isRecord(value)) return fail(entity);
  const generate = value.last_generate;
  const grade = value.last_grade;
  if (generate !== null && !isRecord(generate)) return fail(entity, "last_generate");
  if (grade !== null && !isRecord(grade)) return fail(entity, "last_grade");
  return {
    ready_total: countValue(value, "ready_total", entity),
    ready_due: countValue(value, "ready_due", entity),
    waiting_grading: countValue(value, "waiting_grading", entity),
    grading_errors: countValue(value, "grading_errors", entity),
    unconfirmed_results: countValue(value, "unconfirmed_results", entity),
    queue_limit: countValue(value, "queue_limit", entity),
    queue_full: value.queue_full === true,
    last_generate: generate ? {
      at: optionalString(generate, "at", entity),
      status: optionalString(generate, "status", entity),
      added: optionalInteger(generate, "added", entity),
      note: optionalString(generate, "note", entity),
    } : null,
    last_grade: grade ? {
      at: optionalString(grade, "at", entity),
      status: optionalString(grade, "status", entity),
    } : null,
    generation_held: countValue(value, "generation_held", entity),
  };
}

export function parseReviewGenerationHolds(value: unknown): ReviewGenerationHold[] {
  const entity = "問題を作れなかったカード";
  if (!isRecord(value) || !Array.isArray(value.items)) return fail(entity);
  return value.items.map((item) => {
    if (!isRecord(item)) return fail(entity);
    return {
      knowledge_id: stringValue(item, "knowledge_id", entity),
      title: stringValue(item, "title", entity),
      category: stringValue(item, "category", entity),
      failure_count: countValue(item, "failure_count", entity),
      last_reason: stringValue(item, "last_reason", entity),
      last_question: optionalString(item, "last_question", entity),
      last_failed_at: stringValue(item, "last_failed_at", entity),
      retry_after: stringValue(item, "retry_after", entity),
    };
  });
}

export function parseReviewQuestions(value: unknown): ReviewQuestion[] {
  const entity = "出題";
  if (!isRecord(value) || !Array.isArray(value.items)) return fail(entity);
  return value.items.map((item) => {
    if (!isRecord(item)) return fail(entity);
    const format = stringValue(item, "format", entity);
    if (!QUIZ_FORMAT_VALUES.has(format as QuizFormat)) return fail(entity, "format");
    const choices = item.choices;
    if (choices !== null && (!Array.isArray(choices) || !choices.every((choice) => typeof choice === "string"))) {
      return fail(entity, "choices");
    }
    if ((format === "四択") !== Array.isArray(choices)) return fail(entity, "choices");
    return {
      id: countValue(item, "id", entity),
      knowledge_id: stringValue(item, "knowledge_id", entity),
      format: format as QuizFormat,
      question: stringValue(item, "question", entity),
      choices: choices as string[] | null,
      category: stringValue(item, "category", entity),
    };
  });
}

export function parseReviewAnswerResult(value: unknown): ReviewAnswerResult {
  const entity = "回答の受付結果";
  if (!isRecord(value)) return fail(entity);
  const result = value.result;
  if (result !== undefined && result !== null && !isRecord(result)) return fail(entity, "result");
  let parsedResult: ReviewAnswerResult["result"] = null;
  if (result) {
    const verdict = stringValue(result, "verdict", entity);
    if (!VERDICT_VALUES.has(verdict as QuizVerdict)) return fail(entity, "verdict");
    parsedResult = {
      quiz_log_id: optionalInteger(result, "quiz_log_id", entity),
      quality: countValue(result, "quality", entity),
      verdict: verdict as QuizVerdict,
      correct_answer: stringValue(result, "correct_answer", entity),
      explanation: stringValue(result, "explanation", entity),
    };
  }
  return {
    id: countValue(value, "id", entity),
    status: stringValue(value, "status", entity),
    expected_answer: optionalString(value, "expected_answer", entity),
    result: parsedResult,
  };
}

export function parsePendingReviewAnswers(value: unknown): PendingReviewAnswer[] {
  const entity = "採点待ちの回答";
  if (!isRecord(value) || !Array.isArray(value.items)) return fail(entity);
  return value.items.map((item) => {
    if (!isRecord(item)) return fail(entity);
    const status = stringValue(item, "status", entity);
    if (status !== "answered" && status !== "grading" && status !== "error") return fail(entity, "status");
    return {
      id: countValue(item, "id", entity),
      knowledge_id: stringValue(item, "knowledge_id", entity),
      format: stringValue(item, "format", entity),
      question: stringValue(item, "question", entity),
      answer_text: stringValue(item, "answer_text", entity),
      answered_at: stringValue(item, "answered_at", entity),
      status,
      last_error: optionalString(item, "last_error", entity),
    };
  });
}

const BATCH_STATUS_VALUES = new Set(["succeeded", "skipped", "failed", "busy"]);

export function parseReviewBatchSummary(value: unknown): ReviewBatchSummary {
  const entity = "バッチの実行結果";
  if (!isRecord(value)) return fail(entity);
  const kind = stringValue(value, "kind", entity);
  const status = stringValue(value, "status", entity);
  if ((kind !== "generate" && kind !== "grade") || !BATCH_STATUS_VALUES.has(status)) return fail(entity, "status");
  return {
    kind,
    status: status as ReviewBatchSummary["status"],
    processed: countValue(value, "processed", entity),
    succeeded: countValue(value, "succeeded", entity),
    failed: countValue(value, "failed", entity),
    note: optionalString(value, "note", entity),
    followUp: isRecord(value.followUp) ? parseReviewBatchSummary(value.followUp) : undefined,
  };
}

export function parseMasteryHistoryEvent(value: unknown): MasteryHistoryEvent {
  const entity = "習熟度履歴";
  if (!isRecord(value)) return fail(entity);
  const mastery = stringValue(value, "to_mastery", entity);
  if (!MASTERY_VALUES.has(mastery as Mastery)) return fail(entity, "to_mastery");
  if (typeof value.is_baseline !== "boolean") return fail(entity, "is_baseline");
  return {
    id: numberValue(value, "id", entity),
    knowledge_id: stringValue(value, "knowledge_id", entity),
    to_mastery: mastery as Mastery,
    is_baseline: value.is_baseline,
    changed_at: stringValue(value, "changed_at", entity),
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

export function parseSpeakingPracticeStart(value: unknown): SpeakingPracticeStart {
  const entity = "英会話出題";
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 15) {
    return fail(entity);
  }
  const seen = new Set<string>();
  const items = value.items.map((entry): SpeakingPracticePrompt => {
    if (!isRecord(entry)) return fail(entity);
    const knowledgeId = stringValue(entry, "knowledge_id", entity);
    const type = stringValue(entry, "practice_type", entity);
    const prompt = stringValue(entry, "prompt_ja", entity).trim();
    const target = stringValue(entry, "target_en", entity).trim();
    if (seen.has(knowledgeId)) return fail(entity, "knowledge_id");
    seen.add(knowledgeId);
    if (!SPEAKING_PRACTICE_TYPE_VALUES.has(type as SpeakingPracticeType)) {
      return fail(entity, "practice_type");
    }
    if (!prompt || !target) return fail(entity, !prompt ? "prompt_ja" : "target_en");
    return {
      knowledge_id: knowledgeId,
      practice_type: type as SpeakingPracticeType,
      prompt_ja: prompt,
      target_en: target,
    };
  });
  return { items };
}

export function parseKnowledgeInsight(value: unknown): KnowledgeInsight {
  const entity = "示唆";
  if (!isRecord(value)) return fail(entity);
  const id = numberValue(value, "id", entity);
  if (!Number.isSafeInteger(id) || id < 1) return fail(entity, "id");
  const body = stringValue(value, "body", entity);
  if (!body.trim() || body.length > 1_000) return fail(entity, "body");
  return {
    id,
    knowledge_id: stringValue(value, "knowledge_id", entity),
    body,
    created_at: stringValue(value, "created_at", entity),
    updated_at: stringValue(value, "updated_at", entity),
  };
}

export function parseInsightGroup(value: unknown): InsightGroup {
  const entity = "示唆グループ";
  if (!isRecord(value)) return fail(entity);
  const id = numberValue(value, "id", entity);
  const title = stringValue(value, "title", entity);
  const guidingQuestion = stringValue(value, "guiding_question", entity);
  if (!Number.isSafeInteger(id) || id < 1) return fail(entity, "id");
  if (!title.trim() || title.length > 120) return fail(entity, "title");
  if (!guidingQuestion.trim() || guidingQuestion.length > 300) return fail(entity, "guiding_question");
  return {
    id,
    title,
    guiding_question: guidingQuestion,
    created_at: stringValue(value, "created_at", entity),
    updated_at: stringValue(value, "updated_at", entity),
  };
}

export function parseInsightGroupMember(value: unknown): InsightGroupMember {
  const entity = "示唆グループの所属";
  if (!isRecord(value)) return fail(entity);
  const groupId = numberValue(value, "group_id", entity);
  const insightId = numberValue(value, "insight_id", entity);
  if (!Number.isSafeInteger(groupId) || groupId < 1) return fail(entity, "group_id");
  if (!Number.isSafeInteger(insightId) || insightId < 1) return fail(entity, "insight_id");
  return { group_id: groupId, insight_id: insightId };
}

export function parseInsightAnalysis(value: unknown): InsightAnalysis {
  const entity = "示唆のまとめ";
  if (!isRecord(value) || !Array.isArray(value.themes)) return fail(entity);
  const analyzedCount = numberValue(value, "analyzed_count", entity);
  if (!Number.isSafeInteger(analyzedCount) || analyzedCount < 0) return fail(entity, "analyzed_count");
  const themes = value.themes.map((theme) => {
    if (!isRecord(theme) || !Array.isArray(theme.insight_ids)) return fail(entity, "themes");
    const ids = theme.insight_ids;
    if (!ids.every((id) => Number.isSafeInteger(id))) return fail(entity, "insight_ids");
    if (theme.guiding_question !== undefined && typeof theme.guiding_question !== "string") {
      return fail(entity, "guiding_question");
    }
    return {
      title: stringValue(theme, "title", entity),
      guiding_question: typeof theme.guiding_question === "string" ? theme.guiding_question : "",
      summary: stringValue(theme, "summary", entity),
      importance: stringValue(theme, "importance", entity),
      insight_ids: ids as number[],
    };
  });
  return { themes, analyzed_count: analyzedCount };
}
