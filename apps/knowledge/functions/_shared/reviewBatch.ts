import type { AnthropicEnv } from "./anthropicClient.ts";
import { gradeAnswers, instantGrade, isKnowledgeFact, type Grade, type KnowledgeFact } from "./answerGrading.ts";
import {
  allowedFormats,
  generateQuestions,
  generationIssue,
  groupRecentNotes,
  isPickedItem,
  NOTES_PER_ITEM,
  shuffle,
  type PickedItem,
} from "./questionGeneration.ts";
import { AUTO_FORMAT, QUIZ_FORMATS, type QuizFormat } from "./quizValidation.ts";
import { callRpc, firstRow, isRecord } from "./reviewQueue.ts";
import { inFilter, requestSupabaseRows, type SupabaseEnv } from "./supabaseRest.ts";

export type BatchTrigger = "schedule" | "manual" | "after_grade";

export interface BatchSummary {
  kind: "generate" | "grade";
  /** busy: 同じ種類のバッチが実行中だったため何もしなかった。 */
  status: "succeeded" | "skipped" | "failed" | "busy";
  processed: number;
  succeeded: number;
  failed: number;
  note: string | null;
  /** 採点後に再学習分だけを生成したときの結果。 */
  followUp?: BatchSummary;
}

type BatchEnv = SupabaseEnv & AnthropicEnv;

/** 1回の採点バッチで取り出す回答数。 */
const GRADING_BATCH_SIZE = 30;

interface GenerationCandidate extends PickedItem {
  tags: string[];
  content_version: number;
}

function isGenerationCandidate(value: unknown): value is GenerationCandidate {
  if (!isPickedItem(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string")
    && typeof record.content_version === "number" && Number.isSafeInteger(record.content_version);
}

interface ClaimedAnswer {
  id: number;
  knowledge_id: string;
  format: QuizFormat;
  question: string;
  choices: string[] | null;
  correct_choice: string | null;
  prepared_explanation: string | null;
  answer_text: string;
}

function isClaimedAnswer(value: unknown): value is ClaimedAnswer {
  if (!isRecord(value)) return false;
  return typeof value.id === "number" && typeof value.knowledge_id === "string"
    && typeof value.format === "string" && (QUIZ_FORMATS as readonly string[]).includes(value.format)
    && typeof value.question === "string" && typeof value.answer_text === "string"
    && (value.choices === null || (Array.isArray(value.choices) && value.choices.every((c) => typeof c === "string")))
    && (value.correct_choice === null || typeof value.correct_choice === "string")
    && (value.prepared_explanation === null || typeof value.prepared_explanation === "string");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

async function beginRun(env: BatchEnv, kind: "generate" | "grade", trigger: BatchTrigger): Promise<number | null> {
  const data = await callRpc(env, "begin_review_batch", { p_kind: kind, p_trigger: trigger });
  return typeof data === "number" ? data : null;
}

async function finishRun(env: BatchEnv, runId: number, summary: BatchSummary): Promise<BatchSummary> {
  try {
    await callRpc(env, "finish_review_batch", {
      p_run_id: runId,
      p_status: summary.status === "busy" ? "skipped" : summary.status,
      p_processed: summary.processed,
      p_succeeded: summary.succeeded,
      p_failed: summary.failed,
      p_note: summary.note,
    });
  } catch (error) {
    // 実行記録の失敗で処理結果を失わせない。15分後に打ち切り扱いになる。
    console.error("Failed to finish review batch run", errorMessage(error));
  }
  return summary;
}

/**
 * 出題の生成バッチ。キューが上限なら、どんな条件でもAIを呼ばない。
 * 条件を満たさなかった問題はその場で1回だけ作り直し、それでも満たさないカードは
 * hold_review_generation_failures で時間を置くまで生成の対象から外す。
 */
export async function runGenerationBatch(
  env: BatchEnv,
  trigger: BatchTrigger,
  relearningOnly = false,
): Promise<BatchSummary> {
  const base = { kind: "generate" as const, processed: 0, succeeded: 0, failed: 0 };
  const runId = await beginRun(env, "generate", trigger);
  if (runId === null) return { ...base, status: "busy", note: "生成バッチが実行中のため見送りました。" };

  try {
    const status = firstRow(await callRpc(env, "get_review_queue_status", {}));
    const readyTotal = Number(status?.ready_total);
    const queueLimit = Number(status?.queue_limit);
    if (!status || !Number.isFinite(readyTotal) || !Number.isFinite(queueLimit)) {
      throw new Error("キューの件数を確認できませんでした。");
    }
    if (status.queue_full === true || readyTotal >= queueLimit) {
      return finishRun(env, runId, {
        ...base,
        status: "skipped",
        note: `出題待ちの問題が上限（${queueLimit}件）に達しているため、生成しませんでした。`,
      });
    }

    const picked = await callRpc(env, "pick_review_generation_candidates", {
      p_limit: queueLimit - readyTotal,
      p_relearning_only: relearningOnly,
    });
    if (!Array.isArray(picked)) throw new Error("生成対象の応答形式が正しくありません。");
    const candidates = picked.filter(isGenerationCandidate);
    if (candidates.length !== picked.length) throw new Error("生成対象に必須項目の不足があります。");
    if (candidates.length === 0) {
      const held = Number(status.generation_held);
      return finishRun(env, runId, {
        ...base,
        status: "skipped",
        note: Number.isSafeInteger(held) && held > 0
          ? `新しく生成する問題はありませんでした（問題を作れず保留中のカードが${held}件あります）。`
          : "新しく生成する問題はありませんでした。",
      });
    }

    const ids = candidates.map((item) => item.id);
    const notes = await callRpc(env, "get_recent_quiz_notes", { p_knowledge_ids: ids, p_per_item: NOTES_PER_ITEM });
    if (!Array.isArray(notes)) throw new Error("過去の復習記録の応答形式が正しくありません。");
    const allowedById = new Map(candidates.map((item) => [item.id, allowedFormats(item, AUTO_FORMAT)]));
    const tagsById = new Map(candidates.map((item) => [item.id, item.tags]));

    const notesById = groupRecentNotes(notes);
    const generated = await generateQuestions(env, candidates, allowedById, tagsById, notesById);
    if (!generated.ok) {
      return finishRun(env, runId, {
        ...base,
        status: "failed",
        processed: candidates.length,
        failed: candidates.length,
        note: `${generated.failure.stage}: ${generated.failure.reason}`,
      });
    }

    const first = collectQuestions(candidates, generated);
    const items = first.items;
    let rejected = first.rejected;
    let regenerated = 0;
    let retryFailure: string | null = null;
    // 条件を満たさなかった項目だけ、前回の問題文と理由を添えてその場で1回だけ作り直す。
    if (rejected.size > 0) {
      const retryItems = candidates.filter((item) => rejected.has(item.id));
      const previousById = new Map([...rejected].map(([id, value]) => [id, { question: value.question, problem: value.reason }]));
      const retried = await generateQuestions(env, retryItems, allowedById, tagsById, notesById, previousById);
      if (retried.ok) {
        const second = collectQuestions(retryItems, retried);
        items.push(...second.items);
        regenerated = second.items.length;
        rejected = second.rejected;
      } else {
        retryFailure = `${retried.failure.stage}: ${retried.failure.reason}`;
      }
    }

    const added = items.length > 0
      ? Number(await callRpc(env, "enqueue_review_questions", { p_items: items }))
      : 0;
    // 作り直しても条件を満たさなかったカードは、時間を置くまで生成の対象から外す。
    let holdFailure: string | null = null;
    if (rejected.size > 0) {
      try {
        await callRpc(env, "hold_review_generation_failures", {
          p_items: candidates.flatMap((item) => {
            const failure = rejected.get(item.id);
            return failure
              ? [{ knowledge_id: item.id, content_version: item.content_version, reason: failure.reason, question: failure.question }]
              : [];
          }),
        });
      } catch (error) {
        holdFailure = errorMessage(error);
        console.error("Failed to hold review generation failures", holdFailure);
      }
    }

    const failed = rejected.size;
    const firstIssue = rejected.values().next().value?.reason;
    const messages = [
      regenerated > 0 ? `${regenerated}件は作り直して採用しました。` : null,
      retryFailure ? `作り直しのAI呼び出しに失敗しました（${retryFailure}）。` : null,
      failed > 0
        ? holdFailure
          ? `${failed}件は作り直しても条件を満たさず、保留の記録にも失敗したため、次のバッチでまた作り直します（例: ${firstIssue}）。`
          : `${failed}件は作り直しても条件を満たさなかったため、時間を置いて再挑戦します（例: ${firstIssue}）。`
        : null,
    ].filter((note): note is string => note !== null);
    // AIは応答したので、一部（全部でも）のカードが条件を満たさなかっただけならバッチは成功扱いにする。
    return finishRun(env, runId, {
      ...base,
      status: "succeeded",
      processed: candidates.length,
      succeeded: Number.isFinite(added) ? added : 0,
      failed,
      note: messages.length > 0 ? messages.join("") : null,
    });
  } catch (error) {
    return finishRun(env, runId, { ...base, status: "failed", note: errorMessage(error) });
  }
}

interface QueueItem {
  knowledge_id: string;
  content_version: number;
  format: QuizFormat;
  question: string;
  choices: string[] | null;
  correct_choice: string | null;
  prepared_explanation: string | null;
  expected_answer: string | null;
}

/** 生成結果を、キューに入れる問題と、条件を満たさなかった項目（理由とAIの問題文）に分ける。 */
function collectQuestions(
  candidates: GenerationCandidate[],
  generated: Extract<Awaited<ReturnType<typeof generateQuestions>>, { ok: true }>,
): { items: QueueItem[]; rejected: Map<string, { reason: string; question: string | null }> } {
  const items: QueueItem[] = [];
  const rejected = new Map<string, { reason: string; question: string | null }>();
  for (const item of candidates) {
    const question = generated.byId.get(item.id);
    const issue = generationIssue(item, question, generated.issueById.get(item.id));
    if (issue || !question) {
      rejected.set(item.id, {
        reason: issue ?? "問題を確認できませんでした。",
        question: question?.question ?? generated.questionTextById.get(item.id) ?? null,
      });
      continue;
    }
    items.push({
      knowledge_id: item.id,
      content_version: item.content_version,
      format: question.format,
      question: question.question,
      // 正解の位置が偏らないよう、保存する時点で並べ替える。
      choices: question.choices ? shuffle(question.choices) : null,
      correct_choice: question.correctChoice,
      prepared_explanation: question.explanation,
      expected_answer: question.expectedAnswer,
    });
  }
  return { items, rejected };
}

/**
 * 採点バッチ。四択と無回答はAIを呼ばずに確定し、それ以外をまとめてAIで採点する。
 * 失敗した回答は次のバッチへ戻し、規定回数を超えたら採点エラーにする。
 * 再学習に入った回答があれば、その分の問題だけを続けて生成する。
 */
export async function runGradingBatch(env: BatchEnv, trigger: BatchTrigger): Promise<BatchSummary> {
  const base = { kind: "grade" as const, processed: 0, succeeded: 0, failed: 0 };
  const runId = await beginRun(env, "grade", trigger);
  if (runId === null) return { ...base, status: "busy", note: "採点バッチが実行中のため見送りました。" };

  let summary: BatchSummary;
  let relearningRecorded = false;
  try {
    const claimed = await callRpc(env, "claim_review_answers", { p_limit: GRADING_BATCH_SIZE });
    if (!Array.isArray(claimed)) throw new Error("採点待ちの応答形式が正しくありません。");
    const answers = claimed.filter(isClaimedAnswer);
    if (answers.length !== claimed.length) throw new Error("採点待ちの回答に必須項目の不足があります。");
    if (answers.length === 0) {
      return finishRun(env, runId, { ...base, status: "skipped", note: "採点待ちの回答はありませんでした。" });
    }

    const knowledge = await requestSupabaseRows(env, {
      table: "knowledge",
      params: new URLSearchParams({
        id: inFilter([...new Set(answers.map((answer) => answer.knowledge_id))]),
        select: "id,title,explanation,category,tags,archived",
      }),
    });
    if (!knowledge.ok) throw new Error("採点対象のナレッジを取得できませんでした。");
    const factById = new Map(knowledge.rows.filter(isKnowledgeFact).map((fact) => [fact.id, fact]));

    const gradeByItem = new Map<number, Grade>();
    const errorByItem = new Map<number, string>();
    const aiAnswers: { item: ClaimedAnswer; fact: KnowledgeFact }[] = [];
    for (const item of answers) {
      const fact = factById.get(item.knowledge_id);
      if (!fact || fact.archived) {
        // 記録関数がアーカイブを確認して破棄する。AIは呼ばない。
        gradeByItem.set(item.id, { quality: 0, verdict: "不正解", correctAnswer: "", explanation: "", note: "" });
        continue;
      }
      const instant = instantGrade({
        fact,
        format: item.format,
        answer: item.answer_text,
        correctChoice: item.correct_choice,
        preparedExplanation: item.prepared_explanation,
      });
      if (instant) gradeByItem.set(item.id, instant);
      else aiAnswers.push({ item, fact });
    }

    if (aiAnswers.length > 0) {
      const graded = await gradeAnswers(env, aiAnswers.map(({ item, fact }) => ({
        key: String(item.id),
        fact,
        format: item.format,
        question: item.question,
        choices: item.choices,
        choiceIsCorrect: item.format === "四択" ? item.answer_text === item.correct_choice : null,
        answer: item.answer_text,
      })));
      for (const { item } of aiAnswers) {
        const grade = graded.grades.get(String(item.id));
        if (grade) gradeByItem.set(item.id, grade);
        else errorByItem.set(item.id, graded.errors.get(String(item.id)) ?? "採点結果を得られませんでした。");
      }
    }

    let succeeded = 0;
    for (const item of answers) {
      const grade = gradeByItem.get(item.id);
      if (!grade) continue;
      try {
        const row = firstRow(await callRpc(env, "record_review_grade", {
          p_item_id: item.id,
          p_quality: grade.quality,
          p_verdict: grade.verdict,
          p_note: grade.note,
          p_correct_answer: grade.correctAnswer,
          p_explanation: grade.explanation,
        }));
        if (row?.status === "graded") {
          succeeded += 1;
          if (grade.quality <= 3) relearningRecorded = true;
        }
      } catch (error) {
        errorByItem.set(item.id, errorMessage(error));
      }
    }

    for (const [itemId, error] of errorByItem) {
      try {
        await callRpc(env, "release_review_answer", { p_item_id: itemId, p_error: error });
      } catch (releaseError) {
        // 戻せなかった回答は10分後に採点待ちへ自動で戻る。
        console.error("Failed to release review answer", itemId, errorMessage(releaseError));
      }
    }

    summary = await finishRun(env, runId, {
      ...base,
      status: errorByItem.size === 0 ? "succeeded" : succeeded > 0 ? "succeeded" : "failed",
      processed: answers.length,
      succeeded,
      failed: errorByItem.size,
      note: errorByItem.size > 0
        ? `${errorByItem.size}件は採点できなかったため、次のバッチで再試行します（例: ${errorByItem.values().next().value}）。`
        : null,
    });
  } catch (error) {
    return finishRun(env, runId, { ...base, status: "failed", note: errorMessage(error) });
  }

  if (relearningRecorded) {
    try {
      summary.followUp = await runGenerationBatch(env, "after_grade", true);
    } catch (error) {
      console.error("Relearning generation after grading failed", errorMessage(error));
    }
  }
  return summary;
}
