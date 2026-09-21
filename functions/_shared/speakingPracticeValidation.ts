import { isUuid, readJsonBody } from "./knowledgeValidation.ts";

export const SPEAKING_PRACTICE_ACTION_HEADER = "speaking-practice";
const MAX_REQUEST_CHARS = 4_000;
const PRACTICE_TYPES = new Set(["instant_composition", "read_aloud"]);
const RATINGS = new Set(["smooth", "almost", "retry"]);

export interface SpeakingPracticeInput {
  attempt_id: string;
  session_id: string;
  knowledge_id: string;
  practice_type: "instant_composition" | "read_aloud";
  rating: "smooth" | "almost" | "retry";
  answer_text: string | null;
  repetitions: number;
}

type ValidationResult =
  | { ok: true; value: SpeakingPracticeInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSpeakingPracticeRequest(request: Request): Response | null {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return Response.json({ error: "リクエストURLが正しくありません。" }, { status: 400 });
  }
  if (request.headers.get("Origin") !== origin) {
    return Response.json({ error: "許可されていない送信元です。" }, { status: 403 });
  }
  if (request.headers.get("X-Dashboard-Action") !== SPEAKING_PRACTICE_ACTION_HEADER) {
    return Response.json({ error: "練習記録用ヘッダーがありません。" }, { status: 403 });
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "JSON形式で送信してください。" }, { status: 415 });
  }
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_CHARS) {
    return Response.json({ error: "リクエストが大きすぎます。" }, { status: 413 });
  }
  return null;
}

export async function readSpeakingPracticeBody(request: Request): Promise<unknown | Response> {
  const json = await readJsonBody(request);
  if (!json.ok) return Response.json({ error: json.error }, { status: json.status });
  return json.value;
}

export function validateSpeakingPracticeInput(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, error: "入力内容の形式が正しくありません。" };
  const allowed = new Set([
    "attempt_id", "session_id", "knowledge_id", "practice_type",
    "rating", "answer_text", "repetitions",
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, error: `記録できない項目が含まれています: ${unknown}` };
  if (
    typeof input.attempt_id !== "string" || !isUuid(input.attempt_id)
    || typeof input.session_id !== "string" || !isUuid(input.session_id)
    || typeof input.knowledge_id !== "string" || !isUuid(input.knowledge_id)
  ) {
    return { ok: false, error: "練習IDまたはナレッジIDが正しくありません。" };
  }
  if (typeof input.practice_type !== "string" || !PRACTICE_TYPES.has(input.practice_type)) {
    return { ok: false, error: "練習種別が正しくありません。" };
  }
  if (typeof input.rating !== "string" || !RATINGS.has(input.rating)) {
    return { ok: false, error: "自己評価が正しくありません。" };
  }
  const answer = input.answer_text;
  if (answer !== null && answer !== undefined && typeof answer !== "string") {
    return { ok: false, error: "回答の形式が正しくありません。" };
  }
  const answerText = typeof answer === "string" ? answer.trim() : "";
  if (answerText.length > 2_000) {
    return { ok: false, error: "回答は2,000文字以内で入力してください。" };
  }
  if (!Number.isSafeInteger(input.repetitions) || (input.repetitions as number) < 1 || (input.repetitions as number) > 20) {
    return { ok: false, error: "練習回数は1〜20回で指定してください。" };
  }
  return {
    ok: true,
    value: {
      attempt_id: input.attempt_id,
      session_id: input.session_id,
      knowledge_id: input.knowledge_id,
      practice_type: input.practice_type as SpeakingPracticeInput["practice_type"],
      rating: input.rating as SpeakingPracticeInput["rating"],
      answer_text: answerText || null,
      repetitions: input.repetitions as number,
    },
  };
}
