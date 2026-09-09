import type { Knowledge, KnowledgeDraft, QuizLog } from "../types";

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

async function getJson<T>(path: string): Promise<T> {
  const data = await requestJson(path, { method: "GET" });
  if (!Array.isArray(data)) {
    throw new Error("APIから想定外の応答を受信しました。");
  }
  return data as T;
}

export function getKnowledge(): Promise<Knowledge[]> {
  return getJson<Knowledge[]>("/api/knowledge");
}

export function getQuizLog(): Promise<QuizLog[]> {
  return getJson<QuizLog[]>("/api/quiz-log");
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
  if (typeof data !== "object" || data === null || Array.isArray(data) || typeof (data as { id?: unknown }).id !== "string") {
    throw new Error("更新APIから想定外の応答を受信しました。");
  }
  return data as Knowledge;
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
