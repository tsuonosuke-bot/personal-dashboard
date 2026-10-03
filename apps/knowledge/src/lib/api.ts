import type {
  DailyReviewStatus, InsightAnalysis, InsightGroup, InsightGroupMember, Knowledge, KnowledgeInsight, KnowledgeDraft, MasteryHistoryEvent, QuizLog,
  PendingReviewAnswer, ReviewAnswerResult, ReviewBatchSummary, ReviewGenerationHold, ReviewQuestion, ReviewQueueStatus,
  SpeakingPracticeLog, SpeakingPracticeMode, SpeakingPracticeStart,
  SpeakingPracticeWrite,
} from "../types";
import {
  parseDailyReviewStatus,
  parseInsightAnalysis,
  parseInsightGroup,
  parseInsightGroupMember,
  parseKnowledgeInsight,
  parseKnowledge,
  parseMasteryHistoryEvent,
  parsePageEnvelope,
  parsePendingReviewAnswers,
  parseQuizLog,
  parseReviewAnswerResult,
  parseReviewBatchSummary,
  parseReviewGenerationHolds,
  parseReviewQuestions,
  parseReviewQueueStatus,
  parseSpeakingPracticeLog,
  parseSpeakingPracticeStart,
} from "./apiValidation.ts";

interface ErrorBody {
  error?: unknown;
  stage?: unknown;
  reason?: unknown;
  action?: unknown;
  details?: unknown;
  reference?: unknown;
}

export interface ApiErrorContext {
  stage?: string;
  reason?: string;
  action?: string;
  details?: string[];
  reference?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly stage?: string;
  readonly reason?: string;
  readonly action?: string;
  readonly details: string[];
  readonly reference?: string;

  constructor(message: string, status: number, context: ApiErrorContext = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.stage = context.stage;
    this.reason = context.reason;
    this.action = context.action;
    this.details = context.details ?? [];
    this.reference = context.reference;
  }
}

function appPath(path: string): string {
  if (typeof window === "undefined") return path;
  const basePath = new URL(import.meta.env.BASE_URL, window.location.href).pathname.replace(/\/$/, "");
  return `${basePath}${path}`;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function responseMessage(response: Response): string {
  if (response.status === 401) return "認証の有効期限が切れました。ページを再読み込みしてログインしてください。";
  if (response.status === 403) return "この操作を行う権限を確認できませんでした。";
  if (response.status === 404) return "要求した機能が見つかりませんでした。";
  if (response.status === 429) return "アクセスが集中しています。少し待ってから再試行してください。";
  if (response.status >= 500) return "サーバーへ接続できませんでした。少し待ってから再試行してください。";
  return response.ok
    ? "サーバーから想定外の応答を受信しました。再試行してください。"
    : "処理を完了できませんでした。再試行してください。";
}

export async function readApiResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.includes("json")) throw new ApiError(responseMessage(response), response.status);
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(responseMessage(response), response.status);
  }
  if (!text.trim()) throw new ApiError(responseMessage(response), response.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("サーバーから想定外の応答を受信しました。再試行してください。", response.status);
  }
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(appPath(path), {
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError("ネットワークへ接続できませんでした。通信状態を確認して再試行してください。", 0);
  }

  const responseBody = await readApiResponse(response);

  if (!response.ok) {
    let message = responseMessage(response);
    let context: ApiErrorContext = {};
    if (typeof responseBody === "object" && responseBody !== null) {
      const body = responseBody as ErrorBody;
      message = nonEmptyString(body.error) ?? message;
      context = {
        stage: nonEmptyString(body.stage),
        reason: nonEmptyString(body.reason),
        action: nonEmptyString(body.action),
        details: Array.isArray(body.details)
          ? body.details.flatMap((detail) => nonEmptyString(detail) ?? []).slice(0, 30)
          : [],
        reference: nonEmptyString(body.reference),
      };
    }
    throw new ApiError(message, response.status, context);
  }

  return responseBody;
}

const API_PAGE_SIZE = 1_000;
const MAX_PAGE_REQUESTS = 10_000;

async function getAllPages<T>(
  path: string,
  parseItem: (value: unknown) => T,
): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  let requestCount = 0;

  while (true) {
    requestCount++;
    if (requestCount > MAX_PAGE_REQUESTS) {
      throw new Error("データ件数が安全な取得上限を超えています。");
    }
    const separator = path.includes("?") ? "&" : "?";
    const data = await requestJson(
      `${path}${separator}limit=${API_PAGE_SIZE}&offset=${offset}`,
      { method: "GET" },
    );
    const page = parsePageEnvelope(data);
    if (page.offset !== offset || page.limit !== API_PAGE_SIZE) {
      throw new Error("APIのページ情報が要求内容と一致しません。");
    }
    result.push(...page.items.map(parseItem));

    if (page.items.length === 0) break;
    offset += page.items.length;
    if (page.total !== null && offset >= page.total) break;
  }
  return result;
}

export function getKnowledge(): Promise<Knowledge[]> {
  return getAllPages("/api/knowledge?status=all", parseKnowledge);
}

export function getQuizLog(): Promise<QuizLog[]> {
  return getAllPages("/api/quiz-log", parseQuizLog);
}

export function getMasteryHistory(): Promise<MasteryHistoryEvent[]> {
  return getAllPages("/api/mastery-history", parseMasteryHistoryEvent);
}

export function getSpeakingPracticeLog(from: string): Promise<SpeakingPracticeLog[]> {
  return getAllPages(
    `/api/speaking-practice?from=${encodeURIComponent(from)}`,
    parseSpeakingPracticeLog,
  );
}

const INSIGHT_HEADERS = {
  "Content-Type": "application/json",
  "X-Dashboard-Action": "knowledge-insight",
};

export function getInsights(): Promise<KnowledgeInsight[]> {
  return getAllPages("/api/insights", parseKnowledgeInsight);
}

export async function createInsight(knowledgeId: string, body: string): Promise<KnowledgeInsight> {
  const data = await requestJson("/api/insights", {
    method: "POST",
    headers: INSIGHT_HEADERS,
    body: JSON.stringify({ knowledge_id: knowledgeId, body }),
  });
  return parseKnowledgeInsight(data);
}

export async function updateInsight(insight: KnowledgeInsight, body: string): Promise<KnowledgeInsight> {
  const data = await requestJson(`/api/insights/${insight.id}`, {
    method: "PATCH",
    headers: INSIGHT_HEADERS,
    body: JSON.stringify({ body, expected_updated_at: insight.updated_at }),
  });
  return parseKnowledgeInsight(data);
}

export async function deleteInsight(id: number): Promise<void> {
  await requestJson(`/api/insights/${id}`, {
    method: "DELETE",
    headers: { "X-Dashboard-Action": "knowledge-insight" },
  });
}

export async function analyzeInsights(): Promise<InsightAnalysis> {
  const data = await requestJson("/api/insights/analyze", {
    method: "POST",
    headers: { "X-Dashboard-Action": "knowledge-insight" },
  });
  return parseInsightAnalysis(data);
}

const INSIGHT_GROUP_HEADERS = {
  "Content-Type": "application/json",
  "X-Dashboard-Action": "knowledge-insight-group",
};

export function getInsightGroups(): Promise<InsightGroup[]> {
  return getAllPages("/api/insight-groups", parseInsightGroup);
}

export function getInsightGroupMembers(): Promise<InsightGroupMember[]> {
  return getAllPages("/api/insight-group-members", parseInsightGroupMember);
}

export async function createInsightGroup(title: string, guidingQuestion: string): Promise<InsightGroup> {
  const data = await requestJson("/api/insight-groups", {
    method: "POST",
    headers: INSIGHT_GROUP_HEADERS,
    body: JSON.stringify({ title, guiding_question: guidingQuestion }),
  });
  return parseInsightGroup(data);
}

export async function updateInsightGroup(group: InsightGroup, title: string, guidingQuestion: string): Promise<InsightGroup> {
  const data = await requestJson(`/api/insight-groups/${group.id}`, {
    method: "PATCH",
    headers: INSIGHT_GROUP_HEADERS,
    body: JSON.stringify({ title, guiding_question: guidingQuestion, expected_updated_at: group.updated_at }),
  });
  return parseInsightGroup(data);
}

export async function deleteInsightGroup(group: InsightGroup): Promise<void> {
  await requestJson(`/api/insight-groups/${group.id}`, {
    method: "DELETE",
    headers: INSIGHT_GROUP_HEADERS,
    body: JSON.stringify({ expected_updated_at: group.updated_at }),
  });
}

export async function addInsightGroupMember(groupId: number, insightId: number): Promise<InsightGroupMember> {
  const data = await requestJson("/api/insight-group-members", {
    method: "POST",
    headers: INSIGHT_GROUP_HEADERS,
    body: JSON.stringify({ group_id: groupId, insight_id: insightId }),
  });
  return parseInsightGroupMember(data);
}

export async function removeInsightGroupMember(groupId: number, insightId: number): Promise<void> {
  await requestJson("/api/insight-group-members", {
    method: "DELETE",
    headers: INSIGHT_GROUP_HEADERS,
    body: JSON.stringify({ group_id: groupId, insight_id: insightId }),
  });
}

export async function addDeepDiveToInbox(knowledgeId: string, note: string): Promise<{ id: number }> {
  const data = await requestJson("/api/inbox", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-deep-dive",
    },
    body: JSON.stringify({ knowledgeId, note }),
  });
  const id = typeof data === "object" && data !== null ? (data as { id?: unknown }).id : undefined;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    throw new ApiError("Inboxへの登録結果を確認できませんでした。", 502);
  }
  return { id };
}

export async function recordSpeakingPractice(
  input: SpeakingPracticeWrite,
): Promise<SpeakingPracticeLog> {
  const data = await requestJson("/api/speaking-practice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "speaking-practice",
    },
    body: JSON.stringify(input),
  });
  return parseSpeakingPracticeLog(data);
}

export async function startSpeakingPractice(
  knowledgeIds: string[],
  mode: SpeakingPracticeMode,
): Promise<SpeakingPracticeStart> {
  const data = await requestJson("/api/speaking-practice/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "speaking-practice",
    },
    body: JSON.stringify({ knowledge_ids: knowledgeIds, mode }),
  });
  return parseSpeakingPracticeStart(data);
}

async function writeKnowledge(
  path: string,
  method: "POST" | "PATCH",
  input: unknown,
): Promise<Knowledge> {
  const data = await requestJson(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "knowledge-write",
    },
    body: JSON.stringify(input),
  });
  return parseKnowledge(data);
}

export function createKnowledge(input: KnowledgeDraft): Promise<Knowledge> {
  return writeKnowledge("/api/knowledge", "POST", input);
}

export function updateKnowledge(
  id: string,
  expectedVersion: number,
  input: Partial<KnowledgeDraft> | { archived: boolean },
): Promise<Knowledge> {
  return writeKnowledge(`/api/knowledge/${encodeURIComponent(id)}`, "PATCH", {
    expected_version: expectedVersion,
    changes: input,
  });
}

async function postReviewQueue(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "review-queue",
    },
    body: JSON.stringify(body),
  });
}

export async function getReviewQueueStatus(): Promise<ReviewQueueStatus> {
  return parseReviewQueueStatus(await requestJson("/api/review-queue/status", { method: "GET" }));
}

/** 期限が来た出題待ちの問題を、今の優先度順に受け取る。カテゴリ指定が空なら全カテゴリ。 */
export async function serveReviewQuestions(limit: number, categories: string[] = []): Promise<ReviewQuestion[]> {
  return parseReviewQuestions(await postReviewQueue("/api/review-queue/serve", { limit, categories }));
}

export async function submitReviewAnswer(id: number, answer: string): Promise<ReviewAnswerResult> {
  return parseReviewAnswerResult(await postReviewQueue("/api/review-queue/answer", { id, answer }));
}

/** おかしな問題を報告して捨てる。記録はせず、次の生成で作り直される。 */
export async function discardReviewQuestion(id: number): Promise<void> {
  await postReviewQueue("/api/review-queue/discard", { id });
}

export async function getPendingReviewAnswers(): Promise<PendingReviewAnswer[]> {
  return parsePendingReviewAnswers(await requestJson("/api/review-queue/pending", { method: "GET" }));
}

/** 問題を作り直しても条件を満たさず、生成を保留しているカード。 */
export async function getReviewGenerationHolds(): Promise<ReviewGenerationHold[]> {
  return parseReviewGenerationHolds(await requestJson("/api/review-queue/generation-holds", { method: "GET" }));
}

export async function retryReviewAnswer(id: number): Promise<void> {
  await postReviewQueue("/api/review-queue/retry", { id });
}

export async function confirmReviewResults(quizLogIds: number[]): Promise<number> {
  const data = await postReviewQueue("/api/review-queue/confirm", { quiz_log_ids: quizLogIds });
  return typeof data === "object" && data !== null && typeof (data as { confirmed?: unknown }).confirmed === "number"
    ? (data as { confirmed: number }).confirmed
    : 0;
}

/** 生成・採点バッチを画面から手動で動かす。 */
export async function runReviewBatch(kind: "generate" | "grade"): Promise<ReviewBatchSummary> {
  return parseReviewBatchSummary(await postReviewQueue(`/api/review-batch/${kind}`, {}));
}

export async function getDailyReviewStatus(limit = 15): Promise<DailyReviewStatus> {
  const data = await requestJson(`/api/review/queue?limit=${encodeURIComponent(limit)}`, { method: "GET" });
  return parseDailyReviewStatus(data);
}

