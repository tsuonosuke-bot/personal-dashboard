import type { Knowledge, KnowledgeDraft, QuizLog } from "../types";
import { parseKnowledge, parsePageEnvelope, parseQuizLog } from "./apiValidation.ts";

interface ErrorBody {
  error?: unknown;
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });

  if (!response.ok) {
    let message = `APIエラー (${response.status})`;
    try {
      const body = (await response.json()) as ErrorBody;
      if (typeof body.error === "string") message = body.error;
    } catch {
      // JSONでないエラーレスポンスではステータスを表示する。
    }
    throw new Error(message);
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

async function writeKnowledge(
  path: string,
  method: "POST" | "PATCH",
  input: KnowledgeDraft | Partial<KnowledgeDraft> | { archived: boolean },
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
  input: Partial<KnowledgeDraft> | { archived: boolean },
): Promise<Knowledge> {
  return writeKnowledge(`/api/knowledge/${encodeURIComponent(id)}`, "PATCH", input);
}
