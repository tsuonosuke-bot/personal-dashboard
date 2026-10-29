import { isUuid } from "./knowledgeValidation.ts";

export const GRADING_REPORT_ACTION_HEADER = "grading-report";
export const MAX_REPORT_COMMENT_CHARS = 500;
const MAX_REQUEST_CHARS = 20_000;
const MAX_QUESTION_CHARS = 2_000;
const MAX_ANSWER_CHARS = 2_000;
const MAX_CORRECT_ANSWER_CHARS = 4_000;
const MAX_EXPLANATION_CHARS = 8_000;
const VERDICTS = ["正解", "部分正解", "不正解"] as const;

export interface GradingReportInput {
  knowledgeId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  quality: number;
  verdict: (typeof VERDICTS)[number];
  comment: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const FIELDS = [
  "knowledgeId", "question", "userAnswer", "correctAnswer", "explanation", "quality", "verdict", "comment",
];

export function validateGradingReportRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== GRADING_REPORT_ACTION_HEADER) {
    return { status: 403, error: "採点報告用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readGradingReportInput(request: Request): Promise<Result<GradingReportInput>> {
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
  if (keys.length !== FIELDS.length || !FIELDS.every((field) => keys.includes(field))) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (typeof body.knowledgeId !== "string" || !isUuid(body.knowledgeId)) {
    return { ok: false, status: 400, error: "ナレッジIDが正しくありません。" };
  }
  const limits: [string, number][] = [
    ["question", MAX_QUESTION_CHARS],
    ["userAnswer", MAX_ANSWER_CHARS],
    ["correctAnswer", MAX_CORRECT_ANSWER_CHARS],
    ["explanation", MAX_EXPLANATION_CHARS],
    ["comment", MAX_REPORT_COMMENT_CHARS],
  ];
  for (const [field, max] of limits) {
    const fieldValue = body[field];
    if (typeof fieldValue !== "string" || fieldValue.length > max) {
      return { ok: false, status: 400, error: `${field}の形式または長さが正しくありません。` };
    }
  }
  if (typeof body.quality !== "number" || !Number.isInteger(body.quality) || body.quality < 0 || body.quality > 5) {
    return { ok: false, status: 400, error: "q値が正しくありません。" };
  }
  if (!VERDICTS.includes(body.verdict as (typeof VERDICTS)[number])) {
    return { ok: false, status: 400, error: "判定が正しくありません。" };
  }
  return {
    ok: true,
    value: {
      knowledgeId: body.knowledgeId.toLowerCase(),
      question: (body.question as string).trim(),
      userAnswer: (body.userAnswer as string).trim(),
      correctAnswer: (body.correctAnswer as string).trim(),
      explanation: (body.explanation as string).trim(),
      quality: body.quality,
      verdict: body.verdict as GradingReportInput["verdict"],
      comment: (body.comment as string).trim(),
    },
  };
}

// 1行目をタイトルにする（Idea側の一括整理が1行目をタイトルとして使うため）。
// 後から見直せるよう、問題・回答・AIの採点をそのまま残す。
export function gradingReportContent(input: GradingReportInput, title: string): string {
  const lines = [
    `採点がおかしい: ${title}`,
    ...(input.comment ? [input.comment] : []),
    "",
    `問題: ${input.question || "（不明）"}`,
    `回答: ${input.userAnswer || "（空欄）"}`,
    `AIの採点: ${input.verdict}（q${input.quality}）`,
    `正解: ${input.correctAnswer || "（なし）"}`,
    `講評: ${input.explanation || "（なし）"}`,
    "",
    `報告元: 復習の採点（knowledge ${input.knowledgeId}）`,
  ];
  return lines.join("\n");
}
