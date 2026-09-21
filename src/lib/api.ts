import type {
  DailyReviewStatus, Knowledge, KnowledgeDraft, QuizFormatRequest, QuizGradeResponse, QuizLog,
  QuizStart, RecoveryPreview, SpeakingPracticeLog, SpeakingPracticeWrite,
} from "../types";
import {
  parseDailyReviewStatus,
  parseKnowledge,
  parsePageEnvelope,
  parseQuizGradeResponse,
  parseQuizLog,
  parseQuizStartResponse,
  parseRecoveryPreview,
  parseSpeakingPracticeLog,
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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });

  if (!response.ok) {
    let message = `APIエラー (${response.status})`;
    let context: ApiErrorContext = {};
    try {
      const body = (await response.json()) as ErrorBody;
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
    } catch {
      // JSONでないエラーレスポンスではステータスを表示する。
    }
    throw new ApiError(message, response.status, context);
  }

  return response.json() as Promise<unknown>;
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

export function getSpeakingPracticeLog(from: string): Promise<SpeakingPracticeLog[]> {
  return getAllPages(
    `/api/speaking-practice?from=${encodeURIComponent(from)}`,
    parseSpeakingPracticeLog,
  );
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

async function postQuiz(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "quiz-session",
    },
    body: JSON.stringify(body),
  });
}

export async function startQuiz(
  categories: string[],
  limit: number,
  format: QuizFormatRequest,
  mode: "daily" | "custom" = "custom",
): Promise<QuizStart> {
  const data = await postQuiz("/api/quiz/start", { categories, limit, format, mode });
  return parseQuizStartResponse(data);
}

export async function gradeQuiz(
  answers: { token: string; answer: string }[],
): Promise<QuizGradeResponse> {
  const data = await postQuiz("/api/quiz/grade", answers);
  return parseQuizGradeResponse(data);
}

export async function getDailyReviewStatus(limit = 15): Promise<DailyReviewStatus> {
  const data = await requestJson(`/api/review/queue?limit=${encodeURIComponent(limit)}`, { method: "GET" });
  return parseDailyReviewStatus(data);
}

async function postRecovery(body: unknown): Promise<unknown> {
  return requestJson("/api/review/recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Action": "review-recovery",
    },
    body: JSON.stringify(body),
  });
}

export async function previewReviewRecovery(dailyLimit: number): Promise<RecoveryPreview> {
  return parseRecoveryPreview(await postRecovery({ action: "preview", daily_limit: dailyLimit }));
}

export async function applyReviewRecovery(token: string): Promise<number> {
  const data = await postRecovery({ action: "apply", token });
  if (typeof data !== "object" || data === null || !Number.isSafeInteger((data as { updated?: unknown }).updated)) {
    throw new Error("回復処理の応答が正しくありません。");
  }
  return (data as { updated: number }).updated;
}
