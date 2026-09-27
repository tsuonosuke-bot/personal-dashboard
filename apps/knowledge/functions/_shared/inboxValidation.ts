import { isUuid } from "./knowledgeValidation.ts";

export const INBOX_ACTION_HEADER = "inbox-deep-dive";
export const MAX_DEEP_DIVE_CHARS = 1_000;
const MAX_REQUEST_CHARS = 4_000;

export interface DeepDiveInput {
  knowledgeId: string;
  note: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function validateInboxRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== INBOX_ACTION_HEADER) {
    return { status: 403, error: "Inbox登録用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readDeepDiveInput(request: Request): Promise<Result<DeepDiveInput>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "リクエストを読み取れませんでした。" };
  }
  if (text.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes("knowledgeId") || !keys.includes("note")) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (typeof body.knowledgeId !== "string" || !isUuid(body.knowledgeId)) {
    return { ok: false, status: 400, error: "ナレッジIDが正しくありません。" };
  }
  if (typeof body.note !== "string" || body.note.trim().length === 0) {
    return { ok: false, status: 400, error: "深掘りしたい内容を入力してください。" };
  }
  const note = body.note.trim();
  if (note.length > MAX_DEEP_DIVE_CHARS) {
    return { ok: false, status: 400, error: `深掘りしたい内容は${MAX_DEEP_DIVE_CHARS}文字以内で入力してください。` };
  }
  return { ok: true, value: { knowledgeId: body.knowledgeId.toLowerCase(), note } };
}

// 1行目は利用者の問いにする（Idea側の一括整理が1行目をタイトルとして使うため）。
export function deepDiveContent(input: DeepDiveInput, title: string): string {
  return `${input.note}\n\n深掘り元: 復習「${title}」（knowledge ${input.knowledgeId}）`;
}
