import {
  cancelMessageBatch,
  createMessageBatch,
  QUIZ_MAX_TOKENS,
  QUIZ_MODEL,
  readMessageBatchResults,
  retrieveMessageBatch,
  type AnthropicEnv,
  type AnthropicToolCallResult,
} from "./anthropicClient.ts";
import {
  firstPassGradingRequest,
  gradeAnswers,
  instantGrade,
  isKnowledgeFact,
  type Grade,
  type GradingAnswer,
  type KnowledgeFact,
} from "./answerGrading.ts";
import {
  allowedFormats,
  buildGenerationRequest,
  generateQuestions,
  generationIssue,
  groupRecentNotes,
  isPickedItem,
  NOTES_PER_ITEM,
  shuffle,
  type PickedItem,
  type RecentNote,
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

/*
 * 定期実行（schedule）はMessage Batches API（料金が半額）でAIへ依頼する。結果は非同期に返るため、
 * ある回で送信したバッチを、次以降の回で回収する。結果待ちのバッチに入っているカード・回答は、
 * 新しい依頼に重ねない（採点は claim_review_answers が採点中のまま押さえ、生成は候補から除く）。
 * 画面からの手動実行と採点直後の再学習分は、待たせないよう従来どおりその場で呼ぶ。
 */

/** バッチの結果を待つ上限。APIは24時間で期限切れにするので、それを過ぎたら諦めて記録を閉じる。 */
const AI_BATCH_MAX_AGE_MS = 25 * 60 * 60 * 1000;
const GENERATION_CUSTOM_ID = "generate";
const GRADING_CUSTOM_ID = "grade";

interface PendingAiBatch {
  id: number;
  provider_batch_id: string;
  knowledge_ids: string[];
  item_ids: number[];
  payload: unknown;
  created_at: string;
}

function isPendingAiBatch(value: unknown): value is PendingAiBatch {
  if (!isRecord(value)) return false;
  return typeof value.id === "number" && typeof value.provider_batch_id === "string"
    && Array.isArray(value.knowledge_ids) && value.knowledge_ids.every((id) => typeof id === "string")
    && Array.isArray(value.item_ids) && value.item_ids.every((id) => typeof id === "number")
    && typeof value.created_at === "string";
}

async function listPendingAiBatches(env: BatchEnv, kind: "generate" | "grade"): Promise<PendingAiBatch[]> {
  const rows = await callRpc(env, "list_pending_review_ai_batches", { p_kind: kind });
  if (!Array.isArray(rows)) throw new Error("結果待ちのAIバッチの応答形式が正しくありません。");
  const batches = rows.filter(isPendingAiBatch);
  if (batches.length !== rows.length) throw new Error("結果待ちのAIバッチに必須項目の不足があります。");
  return batches;
}

async function finishAiBatch(env: BatchEnv, id: number, status: "collected" | "failed", note: string | null): Promise<void> {
  try {
    await callRpc(env, "finish_review_ai_batch", { p_id: id, p_status: status, p_note: note });
  } catch (error) {
    // 閉じられなかったバッチは次の回でもう一度回収する。キューへの追加と採点の記録は重複しない。
    console.error("Failed to finish review AI batch", id, errorMessage(error));
  }
}

/** 送信したバッチを記録する。記録できなければ、回収されないバッチを取り消してから失敗を返す。 */
async function registerAiBatch(
  env: BatchEnv,
  providerBatchId: string,
  args: { kind: "generate" | "grade"; knowledgeIds: string[]; itemIds: number[]; payload: unknown },
): Promise<string | null> {
  try {
    await callRpc(env, "register_review_ai_batch", {
      p_kind: args.kind,
      p_provider_batch_id: providerBatchId,
      p_knowledge_ids: args.knowledgeIds,
      p_item_ids: args.itemIds,
      p_payload: args.payload,
    });
    return null;
  } catch (error) {
    await cancelMessageBatch(env, providerBatchId);
    return `送信したAIバッチを記録できませんでした（${errorMessage(error)}）。`;
  }
}

/**
 * バッチの結果を1件取り出す。まだ処理中ならnull。接続の失敗は次の回にもう一度確かめ、
 * 期限（25時間）を過ぎたものだけを失敗として返す。
 */
async function fetchAiBatchResult(
  env: BatchEnv,
  batch: PendingAiBatch,
  customId: string,
  label: string,
): Promise<AnthropicToolCallResult | null> {
  const expired = Date.now() - Date.parse(batch.created_at) > AI_BATCH_MAX_AGE_MS;
  const state = await retrieveMessageBatch(env, batch.provider_batch_id);
  if (!state.ok || !state.ended) {
    if (!expired) return null;
    return state.ok
      ? { ok: false, status: 502, error: "AIのバッチが24時間以内に終わりませんでした。" }
      : state;
  }
  const read = await readMessageBatchResults(env, state.resultsUrl, { label, model: QUIZ_MODEL, maxTokens: QUIZ_MAX_TOKENS });
  if (!read.ok) return expired ? read : null;
  return read.results.get(customId)
    ?? { ok: false, status: 502, error: "AIのバッチ結果にこの依頼が含まれていませんでした。" };
}

/** 1回の実行の集計。回収・送信・その場の処理を合算して finishRun に渡す。 */
interface RunTally {
  processed: number;
  succeeded: number;
  failed: number;
  /** AIの呼び出しかDBの失敗。バッチ全体を failed にする。 */
  broken: boolean;
  /** 何かを回収・送信・記録した。何もしなければ見送り（skipped）にする。 */
  worked: boolean;
  notes: string[];
}

function newTally(): RunTally {
  return { processed: 0, succeeded: 0, failed: 0, broken: false, worked: false, notes: [] };
}

function tallyNote(tally: RunTally): string | null {
  return tally.notes.length > 0 ? tally.notes.join("") : null;
}

interface GenerationBatchPayload {
  candidates: GenerationCandidate[];
  notes: [string, RecentNote[]][];
}

function readGenerationPayload(value: unknown): GenerationBatchPayload | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !Array.isArray(value.notes)) return null;
  if (!value.candidates.every(isGenerationCandidate)) return null;
  const notesValid = value.notes.every((entry) => Array.isArray(entry) && entry.length === 2
    && typeof entry[0] === "string" && Array.isArray(entry[1]));
  return notesValid ? { candidates: value.candidates, notes: value.notes as [string, RecentNote[]][] } : null;
}

/** 生成に必要な表を候補から作る。送信した回と回収した回で同じものになるよう、候補の記録だけから決める。 */
function generationInputs(candidates: GenerationCandidate[], notesById: Map<string, RecentNote[]>) {
  return {
    allowedById: new Map(candidates.map((item) => [item.id, allowedFormats(item, AUTO_FORMAT)])),
    tagsById: new Map(candidates.map((item) => [item.id, item.tags])),
    notesById,
  };
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

  const tally = newTally();
  const finish = (note?: string): Promise<BatchSummary> => {
    if (note) tally.notes.push(note);
    return finishRun(env, runId, {
      ...base,
      status: tally.broken ? "failed" : tally.worked ? "succeeded" : "skipped",
      processed: tally.processed,
      succeeded: tally.succeeded,
      failed: tally.failed,
      note: tallyNote(tally),
    });
  };

  try {
    const useBatchApi = trigger === "schedule";
    // 結果待ちのバッチに入っているカードは、重ねて依頼しない。
    const inFlight = new Set<string>();
    for (const batch of await listPendingAiBatches(env, "generate")) {
      const collected = useBatchApi && await collectGenerationBatch(env, batch, tally);
      if (!collected) for (const id of batch.knowledge_ids) inFlight.add(id);
    }

    const status = firstRow(await callRpc(env, "get_review_queue_status", {}));
    const readyTotal = Number(status?.ready_total);
    const queueLimit = Number(status?.queue_limit);
    if (!status || !Number.isFinite(readyTotal) || !Number.isFinite(queueLimit)) {
      throw new Error("キューの件数を確認できませんでした。");
    }
    if (status.queue_full === true || readyTotal >= queueLimit) {
      return finish(`出題待ちの問題が上限（${queueLimit}件）に達しているため、生成しませんでした。`);
    }

    const picked = await callRpc(env, "pick_review_generation_candidates", {
      p_limit: queueLimit - readyTotal,
      p_relearning_only: relearningOnly,
    });
    if (!Array.isArray(picked)) throw new Error("生成対象の応答形式が正しくありません。");
    const valid = picked.filter(isGenerationCandidate);
    if (valid.length !== picked.length) throw new Error("生成対象に必須項目の不足があります。");
    const candidates = valid.filter((item) => !inFlight.has(item.id));
    if (candidates.length === 0) {
      const held = Number(status.generation_held);
      return finish(valid.length > 0
        ? "新しく生成する問題はありませんでした（対象のカードは結果待ちの生成バッチに入っています）。"
        : Number.isSafeInteger(held) && held > 0
          ? `新しく生成する問題はありませんでした（問題を作れず保留中のカードが${held}件あります）。`
          : "新しく生成する問題はありませんでした。");
    }

    const ids = candidates.map((item) => item.id);
    const notes = await callRpc(env, "get_recent_quiz_notes", { p_knowledge_ids: ids, p_per_item: NOTES_PER_ITEM });
    if (!Array.isArray(notes)) throw new Error("過去の復習記録の応答形式が正しくありません。");
    const inputs = generationInputs(candidates, groupRecentNotes(notes));

    if (useBatchApi) {
      await submitGenerationBatch(env, candidates, inputs, tally);
      return finish();
    }

    const generated = await generateQuestions(env, candidates, inputs.allowedById, inputs.tagsById, inputs.notesById);
    if (!generated.ok) {
      tally.broken = true;
      tally.processed += candidates.length;
      tally.failed += candidates.length;
      tally.notes.push(`${generated.failure.stage}: ${generated.failure.reason}`);
      return finish();
    }
    await storeGeneratedQuestions(env, candidates, inputs, generated, tally);
    return finish();
  } catch (error) {
    return finishRun(env, runId, {
      ...base,
      status: "failed",
      processed: tally.processed,
      succeeded: tally.succeeded,
      failed: tally.failed,
      note: [...tally.notes, errorMessage(error)].join(""),
    });
  }
}

/** 生成をバッチで依頼し、回収に要る候補と過去のメモを記録する。 */
async function submitGenerationBatch(
  env: BatchEnv,
  candidates: GenerationCandidate[],
  inputs: ReturnType<typeof generationInputs>,
  tally: RunTally,
): Promise<void> {
  const created = await createMessageBatch(env, [{
    customId: GENERATION_CUSTOM_ID,
    options: buildGenerationRequest(candidates, inputs.allowedById, inputs.tagsById, inputs.notesById),
  }]);
  if (!created.ok) {
    tally.broken = true;
    tally.notes.push(`AIへの接続: ${created.error}`);
    return;
  }
  const failure = await registerAiBatch(env, created.id, {
    kind: "generate",
    knowledgeIds: candidates.map((item) => item.id),
    itemIds: [],
    payload: { candidates, notes: [...inputs.notesById] } satisfies GenerationBatchPayload,
  });
  if (failure) {
    tally.broken = true;
    tally.notes.push(failure);
    return;
  }
  tally.worked = true;
  tally.notes.push(`${candidates.length}件の問題の生成をバッチで依頼しました（次回以降の実行で取り込みます）。`);
}

/** 終わった生成バッチを回収してキューへ入れる。まだ処理中ならfalse（候補は結果待ちのまま）。 */
async function collectGenerationBatch(env: BatchEnv, batch: PendingAiBatch, tally: RunTally): Promise<boolean> {
  const result = await fetchAiBatchResult(env, batch, GENERATION_CUSTOM_ID, "submit_questions");
  if (!result) return false;
  const payload = readGenerationPayload(batch.payload);
  if (!payload) {
    tally.broken = true;
    tally.notes.push("記録した生成バッチの対象を読み取れませんでした。");
    await finishAiBatch(env, batch.id, "failed", "記録した対象を読み取れませんでした。");
    return true;
  }
  const { candidates } = payload;
  const inputs = generationInputs(candidates, new Map(payload.notes));
  const generated = await generateQuestions(
    env, candidates, inputs.allowedById, inputs.tagsById, inputs.notesById, undefined, result,
  );
  if (!generated.ok) {
    const reason = `${generated.failure.stage}: ${generated.failure.reason}`;
    tally.broken = true;
    tally.processed += candidates.length;
    tally.failed += candidates.length;
    tally.notes.push(reason);
    await finishAiBatch(env, batch.id, "failed", reason);
    return true;
  }
  // 送信から回収までにカードが編集・アーカイブされていれば、enqueue_review_questions が版の照合で入れない。
  await storeGeneratedQuestions(env, candidates, inputs, generated, tally);
  await finishAiBatch(env, batch.id, "collected", null);
  return true;
}

/**
 * 生成結果をキューへ入れる。条件を満たさなかった項目はその場で1回だけ作り直し、
 * それでも満たさないカードは時間を置くまで生成の対象から外す。
 */
async function storeGeneratedQuestions(
  env: BatchEnv,
  candidates: GenerationCandidate[],
  inputs: ReturnType<typeof generationInputs>,
  generated: Extract<Awaited<ReturnType<typeof generateQuestions>>, { ok: true }>,
  tally: RunTally,
): Promise<void> {
  const { allowedById, tagsById, notesById } = inputs;
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
  tally.worked = true;
  tally.processed += candidates.length;
  tally.succeeded += Number.isFinite(added) ? added : 0;
  tally.failed += failed;
  tally.notes.push(...messages);
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
 * 定期実行ではAIの採点をバッチで依頼し、次以降の回で回収して記録する（依頼中の回答は採点中のまま残る）。
 * 失敗した回答は次のバッチへ戻し、規定回数を超えたら採点エラーにする。
 * 再学習に入った回答があれば、その分の問題だけを続けて生成する。
 */
export async function runGradingBatch(env: BatchEnv, trigger: BatchTrigger): Promise<BatchSummary> {
  const base = { kind: "grade" as const, processed: 0, succeeded: 0, failed: 0 };
  const runId = await beginRun(env, "grade", trigger);
  if (runId === null) return { ...base, status: "busy", note: "採点バッチが実行中のため見送りました。" };

  let summary: BatchSummary;
  const tally = newTally();
  let relearningRecorded = false;
  let submitted = 0;
  let firstError: string | null = null;
  const add = (outcome: GradingOutcome, processed: number) => {
    tally.worked = true;
    tally.processed += processed;
    tally.succeeded += outcome.succeeded;
    tally.failed += outcome.errors.size;
    firstError ??= outcome.errors.values().next().value ?? null;
    if (outcome.relearning) relearningRecorded = true;
    submitted += outcome.submitted;
  };
  try {
    const useBatchApi = trigger === "schedule";
    if (useBatchApi) {
      for (const batch of await listPendingAiBatches(env, "grade")) {
        const collected = await collectGradingBatch(env, batch);
        if (collected) add(collected, collected.processed);
      }
    }

    const claimed = await callRpc(env, "claim_review_answers", { p_limit: GRADING_BATCH_SIZE });
    if (!Array.isArray(claimed)) throw new Error("採点待ちの応答形式が正しくありません。");
    const answers = claimed.filter(isClaimedAnswer);
    if (answers.length !== claimed.length) throw new Error("採点待ちの回答に必須項目の不足があります。");
    if (answers.length > 0) add(await gradeClaimedAnswers(env, answers, useBatchApi), answers.length);
    if (!tally.worked) {
      return finishRun(env, runId, { ...base, status: "skipped", note: "採点待ちの回答はありませんでした。" });
    }

    if (tally.failed > 0) {
      tally.notes.push(`${tally.failed}件は採点できなかったため、次のバッチで再試行します（例: ${firstError}）。`);
    }
    if (submitted > 0) tally.notes.push(`${submitted}件の採点をバッチで依頼しました（次回以降の実行で記録します）。`);
    summary = await finishRun(env, runId, {
      ...base,
      // 記録も依頼もできず失敗だけが残ったときに失敗とする。
      status: tally.failed > 0 && tally.succeeded === 0 && submitted === 0 ? "failed" : "succeeded",
      processed: tally.processed,
      succeeded: tally.succeeded,
      failed: tally.failed,
      note: tallyNote(tally),
    });
  } catch (error) {
    return finishRun(env, runId, {
      ...base,
      status: "failed",
      processed: tally.processed,
      succeeded: tally.succeeded,
      failed: tally.failed,
      note: errorMessage(error),
    });
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

interface GradingOutcome {
  succeeded: number;
  errors: Map<number, string>;
  relearning: boolean;
  /** バッチで依頼して、この回では記録しなかった件数。 */
  submitted: number;
}

function toGradingAnswer({ item, fact }: { item: ClaimedAnswer; fact: KnowledgeFact }): GradingAnswer {
  return {
    key: String(item.id),
    fact,
    format: item.format,
    question: item.question,
    choices: item.choices,
    choiceIsCorrect: item.format === "四択" ? item.answer_text === item.correct_choice : null,
    answer: item.answer_text,
  };
}

/** 取り出した回答を採点する。AIが要る回答は、useBatchApi ならバッチで依頼して採点中のまま残す。 */
async function gradeClaimedAnswers(env: BatchEnv, answers: ClaimedAnswer[], useBatchApi: boolean): Promise<GradingOutcome> {
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

  let submitted = 0;
  if (aiAnswers.length > 0 && useBatchApi) {
    const failure = await submitGradingBatch(env, aiAnswers);
    if (failure) for (const { item } of aiAnswers) errorByItem.set(item.id, failure);
    else submitted = aiAnswers.length;
  } else if (aiAnswers.length > 0) {
    const graded = await gradeAnswers(env, aiAnswers.map(toGradingAnswer));
    for (const { item } of aiAnswers) {
      const grade = graded.grades.get(String(item.id));
      if (grade) gradeByItem.set(item.id, grade);
      else errorByItem.set(item.id, graded.errors.get(String(item.id)) ?? "採点結果を得られませんでした。");
    }
  }

  const recorded = await recordGrades(env, answers.map((item) => item.id), gradeByItem, errorByItem);
  return { ...recorded, errors: errorByItem, submitted };
}

/** 採点結果を記録し、採点できなかった回答を次のバッチへ戻す。 */
async function recordGrades(
  env: BatchEnv,
  itemIds: number[],
  gradeByItem: Map<number, Grade>,
  errorByItem: Map<number, string>,
): Promise<{ succeeded: number; relearning: boolean }> {
  let succeeded = 0;
  let relearning = false;
  for (const itemId of itemIds) {
    const grade = gradeByItem.get(itemId);
    if (!grade) continue;
    try {
      const row = firstRow(await callRpc(env, "record_review_grade", {
        p_item_id: itemId,
        p_quality: grade.quality,
        p_verdict: grade.verdict,
        p_note: grade.note,
        p_correct_answer: grade.correctAnswer,
        p_explanation: grade.explanation,
      }));
      if (row?.status === "graded") {
        succeeded += 1;
        if (grade.quality <= 3) relearning = true;
      }
    } catch (error) {
      errorByItem.set(itemId, errorMessage(error));
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
  return { succeeded, relearning };
}

interface GradingBatchPayload {
  answers: { item: ClaimedAnswer; fact: KnowledgeFact }[];
}

function readGradingPayload(value: unknown): GradingBatchPayload | null {
  if (!isRecord(value) || !Array.isArray(value.answers)) return null;
  const valid = value.answers.every((entry) => isRecord(entry) && isClaimedAnswer(entry.item) && isKnowledgeFact(entry.fact));
  return valid ? { answers: value.answers as GradingBatchPayload["answers"] } : null;
}

/** AIの採点をバッチで依頼する。失敗したら理由を返し、呼び出し側が回答を次のバッチへ戻す。 */
async function submitGradingBatch(
  env: BatchEnv,
  aiAnswers: { item: ClaimedAnswer; fact: KnowledgeFact }[],
): Promise<string | null> {
  const request = firstPassGradingRequest(aiAnswers.map(toGradingAnswer));
  if (!request) return "AIへ送る採点がありませんでした。";
  const created = await createMessageBatch(env, [{ customId: GRADING_CUSTOM_ID, options: request }]);
  if (!created.ok) return created.action ? `${created.error}${created.action}` : created.error;
  return registerAiBatch(env, created.id, {
    kind: "grade",
    knowledgeIds: [],
    itemIds: aiAnswers.map(({ item }) => item.id),
    payload: { answers: aiAnswers } satisfies GradingBatchPayload,
  });
}

/**
 * 終わった採点バッチを回収して記録する。まだ処理中ならnull。バッチの応答が欠けた・崩れた回答は、
 * 通常の採点と同じくその場でまとめて、最後は1問ずつ依頼し直す。
 */
async function collectGradingBatch(
  env: BatchEnv,
  batch: PendingAiBatch,
): Promise<(GradingOutcome & { processed: number }) | null> {
  const result = await fetchAiBatchResult(env, batch, GRADING_CUSTOM_ID, "submit_grades");
  if (!result) return null;
  const payload = readGradingPayload(batch.payload);
  if (!payload) {
    const reason = "記録した採点バッチの回答を読み取れませんでした。";
    const errors = new Map(batch.item_ids.map((id) => [id, reason]));
    await recordGrades(env, [], new Map(), errors);
    await finishAiBatch(env, batch.id, "failed", reason);
    return { succeeded: 0, errors, relearning: false, submitted: 0, processed: batch.item_ids.length };
  }
  const graded = await gradeAnswers(env, payload.answers.map(toGradingAnswer), result);
  const gradeByItem = new Map<number, Grade>();
  const errorByItem = new Map<number, string>();
  for (const { item } of payload.answers) {
    const grade = graded.grades.get(String(item.id));
    if (grade) gradeByItem.set(item.id, grade);
    else errorByItem.set(item.id, graded.errors.get(String(item.id)) ?? "採点結果を得られませんでした。");
  }
  const recorded = await recordGrades(env, payload.answers.map(({ item }) => item.id), gradeByItem, errorByItem);
  await finishAiBatch(env, batch.id, result.ok ? "collected" : "failed", result.ok ? null : result.error);
  return { ...recorded, errors: errorByItem, submitted: 0, processed: payload.answers.length };
}
