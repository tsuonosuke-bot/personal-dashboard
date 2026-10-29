/** Acquire and parse AI question results; model and prompt exports remain compatible. */
import { type AnthropicEnv, type AnthropicToolCallResult, callAnthropicTool } from "./anthropicClient.ts";
import { type PickedItem, type RecentNote, type PreviousAttempt, type GeneratedQuestion, type GenerationFailure, type QuestionToolInput, normalizeChoiceSet, MAX_PREPARED_EXPLANATION_CHARS } from "./questionGenerationModel.ts";
import { type QuizFormat, MAX_QUESTION_CHARS } from "./quizValidation.ts";
import { buildGenerationRequest } from "./questionGenerationPrompt.ts";

function describeToolInputShape(input: unknown): string {
  if (typeof input !== "object" || input === null) return input === null ? "null" : typeof input;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 10).join(", ") || "キーなし";
  const questions = "questions" in record
    ? (Array.isArray(record.questions) ? "array" : record.questions === null ? "null" : typeof record.questions)
    : "なし";
  return `keys=[${keys}] questions=${questions}`;
}

/** questionsが配列でなくJSON文字列で返る場合も、中身が配列なら受け入れる。 */
function extractQuestionArray(
  input: unknown,
): { ok: true; value: unknown[] } | { ok: false; shape: string } {
  const raw = (input as { questions?: unknown } | null)?.questions;
  if (Array.isArray(raw)) return { ok: true, value: raw };
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return { ok: true, value: parsed };
    } catch {
      // 下で形だけを報告する。
    }
  }
  return { ok: false, shape: describeToolInputShape(input) };
}

/**
 * AIを呼んで問題文と（四択なら）選択肢を取り出す。選択肢の妥当性チェックは呼び出し側で行う。
 * previousById を渡すと、前回の問題文と不採用の理由を添えて作り直させる。
 * prefetched を渡すと（バッチで受け取った結果）、1回目はAIを呼ばずにそれを使う。
 */
export async function generateQuestions(
  env: AnthropicEnv,
  items: PickedItem[],
  allowedById: Map<string, QuizFormat[]>,
  tagsById: Map<string, string[]>,
  notesById: Map<string, RecentNote[]>,
  previousById?: Map<string, PreviousAttempt>,
  prefetched?: AnthropicToolCallResult,
): Promise<
  | {
    ok: true;
    byId: Map<string, GeneratedQuestion>;
    issueById: Map<string, string>;
    /** 不採用になった項目も含め、AIが返した問題文。作り直しや保留の記録に使う。 */
    questionTextById: Map<string, string>;
  }
  | { ok: false; failure: GenerationFailure }
> {
  let questions: unknown[] | null = null;
  let lastShape = "";
  const request = buildGenerationRequest(items, allowedById, tagsById, notesById, previousById);
  // 大きな入れ子配列ではツール入力が崩れることがあるため、形が不正なら1回だけ生成し直す。
  for (let attempt = 0; attempt < 2 && questions === null; attempt += 1) {
    const generated = attempt === 0 && prefetched ? prefetched : await callAnthropicTool(env, request);
    if (!generated.ok) return {
      ok: false,
      failure: {
        // 打ち切りは接続できた後に起きるため、同じ「AIへの接続」では原因を誤らせる。
        stage: generated.truncated ? "AI応答の確認" : "AIへの接続",
        reason: generated.error,
        action: generated.action ?? "時間を置いて、もう一度出題してください。",
        reference: generated.reference,
        status: generated.status,
      },
    };
    const extracted = extractQuestionArray(generated.input);
    if (extracted.ok) questions = extracted.value;
    else {
      lastShape = extracted.shape;
      console.error("Quiz question tool input had no questions array", `attempt=${attempt + 1}`, lastShape);
    }
  }
  if (questions === null) {
    return {
      ok: false,
      failure: {
        stage: "AI応答の確認",
        reason: `AIの応答にquestions配列が含まれていませんでした（2回試行、受信した形: ${lastShape}）。`,
        action: "もう一度出題してください。繰り返す場合は問題数を減らしてください。",
        status: 502,
      },
    };
  }

  const byId = new Map<string, GeneratedQuestion>();
  const issueById = new Map<string, string>();
  const questionTextById = new Map<string, string>();
  for (const entry of questions as QuestionToolInput[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, question, format, choices, correct_choice, explanation, expected_answer } = entry;
    if (typeof id !== "string") continue;
    const allowed = allowedById.get(id) ?? [];
    if (allowed.length === 0) continue;
    if (typeof question !== "string") {
      issueById.set(id, "問題文が文字列で返されませんでした。");
      continue;
    }
    if (question.trim()) questionTextById.set(id, question.trim());
    // 候補が1つならモデルの申告値に依存せず、サーバーが決めた形式を正本にする。
    // 複数候補のときだけ、モデルに知識の構造に合う形式を選ばせる。
    const reportedFormat = typeof format === "string" ? format : null;
    const formatMismatch = reportedFormat !== null && !allowed.includes(reportedFormat as QuizFormat)
      ? `許可形式「${allowed.join(" / ")}」に対し、AI応答は「${reportedFormat}」でした。`
      : null;
    const selectedFormat = allowed.length === 1
      ? allowed[0]
      : reportedFormat as QuizFormat | null;
    if (!selectedFormat) {
      issueById.set(id, `許可形式「${allowed.join(" / ")}」から出題形式が選ばれていませんでした。`);
      continue;
    }
    // 許可されていない形式は再生成せず、この問題だけを除外する。
    if (formatMismatch) {
      issueById.set(id, formatMismatch);
      continue;
    }
    const trimmed = question.trim();
    if (!trimmed) {
      issueById.set(id, "問題文が空でした。");
      continue;
    }
    if (trimmed.length > MAX_QUESTION_CHARS) {
      issueById.set(id, `問題文が上限の${MAX_QUESTION_CHARS}文字を超えています。`);
      continue;
    }
    const choiceSet = selectedFormat === "四択"
      ? normalizeChoiceSet(choices, correct_choice)
      : null;
    if (choiceSet && !choiceSet.ok) {
      issueById.set(id, choiceSet.reason);
      continue;
    }
    const normalizedChoices = choiceSet?.ok ? choiceSet.value : null;
    byId.set(id, {
      question: trimmed,
      format: selectedFormat,
      choices: normalizedChoices?.choices ?? null,
      correctChoice: normalizedChoices?.correctChoice ?? null,
      explanation: selectedFormat === "四択" && typeof explanation === "string" && explanation.trim()
        ? explanation.trim().slice(0, MAX_PREPARED_EXPLANATION_CHARS)
        : null,
      expectedAnswer: selectedFormat === "四択"
        ? normalizedChoices?.correctChoice ?? null
        : typeof expected_answer === "string" && expected_answer.trim()
          ? expected_answer.trim().slice(0, MAX_PREPARED_EXPLANATION_CHARS)
          : null,
    });
    issueById.delete(id);
  }
  for (const item of items) {
    if (!byId.has(item.id) && !issueById.has(item.id)) {
      issueById.set(item.id, "AIの応答にこの項目の問題が含まれていませんでした。");
    }
  }
  return { ok: true, byId, issueById, questionTextById };
}

export { type GenerationFailure, type RecentNote, groupRecentNotes, NOTES_PER_ITEM, type QuestionFocus, questionFocus, CHOICE_COUNT, type GeneratedQuestion, requestedWordCount, englishTitleWordCount, hasConsistentWordCount, questionRevealsTitle, type PickedItem, isPickedItem, allowedFormats, shuffle, type PreviousAttempt, generationIssue } from "./questionGenerationModel.ts";

export { buildGenerationRequest } from "./questionGenerationPrompt.ts";
