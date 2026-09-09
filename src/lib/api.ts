import type { Knowledge, QuizLog } from "../types";

interface ErrorBody {
  error?: unknown;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
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

  const data: unknown = await response.json();
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
