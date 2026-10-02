import {
  jsonResponse,
  inFilter,
  methodNotAllowed,
  requestSupabaseFunction,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import type { AnthropicEnv } from "../../_shared/anthropicClient.ts";
import { gradeAnswers, isKnowledgeFact } from "../../_shared/answerGrading.ts";
import {
  readQuizJsonBody,
  validateGradeRequest,
  validateQuizRequest,
  type QuizFormat,
} from "../../_shared/quizValidation.ts";
import {
  verifyQuizChoiceAnswer,
  verifyQuizToken,
  type QuizSigningEnv,
} from "../../_shared/quizSession.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv & QuizSigningEnv;
}


const PRIORITIES = new Set(["最高", "高", "中", "低", "最低"]);
const MASTERIES = new Set(["未学習", "学習中", "習得中", "定着"]);

interface KnowledgeReviewState {
  id: string;
  title: string;
  mastery: "未学習" | "学習中" | "習得中" | "定着";
  priority: "最高" | "高" | "中" | "低" | "最低";
  content_version: number;
  next_review_on: string | null;
  next_review_at: string;
  stability_hours: number;
  relearning_stage: "recognition" | "recall" | null;
}

type GradeFailurePhase = "verification" | "grading" | "recording" | "confirmation";

interface GradeFailure {
  index: number;
  id: string | null;
  phase: GradeFailurePhase;
  error: string;
  /** nullは、通信切断などでDBへの保存成否を確認できなかったことを表す。 */
  recorded: boolean | null;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  } catch {
    // JSONでないエラー応答は、利用者向けの安全な既定文へ落とす。
  }
  return fallback;
}

interface RecordedState {
  recorded: boolean;
  schedule_updated: boolean;
}

function parseRecordedRows(data: unknown, allowedIds: Set<string>): Map<string, RecordedState> {
  const rows = new Map<string, RecordedState>();
  if (!Array.isArray(data)) return rows;
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const { id, recorded, schedule_updated } = row as Record<string, unknown>;
    if (
      typeof id !== "string" || !allowedIds.has(id) || rows.has(id)
      || typeof recorded !== "boolean" || typeof schedule_updated !== "boolean"
    ) continue;
    rows.set(id, { recorded, schedule_updated });
  }
  return rows;
}


function isKnowledgeReviewState(value: unknown): value is KnowledgeReviewState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.title === "string"
    && typeof record.mastery === "string"
    && MASTERIES.has(record.mastery)
    && typeof record.priority === "string"
    && PRIORITIES.has(record.priority)
    && typeof record.content_version === "number"
    && Number.isSafeInteger(record.content_version)
    && record.content_version >= 1
    && (record.next_review_on === null || typeof record.next_review_on === "string")
    && typeof record.next_review_at === "string"
    && typeof record.stability_hours === "number"
    && (record.relearning_stage === null || record.relearning_stage === "recognition"
      || record.relearning_stage === "recall");
}



export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");

  const guardError = validateQuizRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readQuizJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateGradeRequest(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);
  const answers = [] as {
    index: number;
    id: string;
    answer: string;
    question: string;
    format: QuizFormat;
    choices: string[] | null;
    correctChoiceProof: string | null;
    attempt_id: string;
  }[];
  const failuresByIndex = new Map<number, GradeFailure>();
  const seenIds = new Set<string>();
  for (const [index, submitted] of validated.value.entries()) {
    const verified = await verifyQuizToken(submitted.token, context.request, context.env);
    if (!verified.ok) {
      failuresByIndex.set(index, {
        index,
        id: null,
        phase: "verification",
        error: verified.error,
        recorded: false,
      });
      continue;
    }
    if (seenIds.has(verified.value.id)) {
      failuresByIndex.set(index, {
        index,
        id: verified.value.id,
        phase: "verification",
        error: "同じ問題への回答が重複しています。",
        recorded: false,
      });
      continue;
    }
    seenIds.add(verified.value.id);
    if (
      verified.value.format === "四択"
      && submitted.answer !== ""
      && !verified.value.choices?.includes(submitted.answer)
    ) {
      failuresByIndex.set(index, {
        index,
        id: verified.value.id,
        phase: "verification",
        error: "四択の回答が提示された選択肢と一致しません。",
        recorded: false,
      });
      continue;
    }
    answers.push({ index, ...verified.value, answer: submitted.answer });
  }
  const ids = answers.map((a) => a.id);

  const finish = (results: unknown[]) => jsonResponse({
    results,
    failures: [...failuresByIndex.values()].sort((left, right) => left.index - right.index),
  });

  if (answers.length === 0) return finish([]);

  const knowledgeResult = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({
      id: inFilter(ids),
      select: "id,title,explanation,category,tags,archived",
    }),
  });
  if (!knowledgeResult.ok) {
    const error = await responseError(knowledgeResult.response, "採点対象のナレッジを取得できませんでした。");
    for (const answer of answers) {
      failuresByIndex.set(answer.index, {
        index: answer.index,
        id: answer.id,
        phase: "verification",
        error,
        recorded: false,
      });
    }
    return finish([]);
  }
  const facts = knowledgeResult.rows.filter(isKnowledgeFact);
  const factById = new Map(facts.map((f) => [f.id, f]));
  const gradableAnswers = answers.filter((answer) => {
    const fact = factById.get(answer.id);
    const error = !fact
      ? "対象のナレッジが見つかりません。"
      : fact.archived
        ? "アーカイブ済みのナレッジは採点できません。"
        : null;
    if (!error) return true;
    failuresByIndex.set(answer.index, {
      index: answer.index,
      id: answer.id,
      phase: "verification",
      error,
      recorded: false,
    });
    return false;
  });

  if (gradableAnswers.length === 0) return finish([]);

  const choiceCorrectById = new Map<string, boolean | null>();
  for (const answer of gradableAnswers) {
    choiceCorrectById.set(
      answer.id,
      answer.format === "四択"
        ? await verifyQuizChoiceAnswer(answer, answer.answer, context.env)
        : null,
    );
  }

  const graded = await gradeAnswers(context.env, gradableAnswers.map((answer) => ({
    key: answer.id,
    fact: factById.get(answer.id)!,
    format: answer.format,
    question: answer.question,
    choices: answer.choices,
    choiceIsCorrect: choiceCorrectById.get(answer.id) ?? null,
    answer: answer.answer,
  })));
  for (const answer of gradableAnswers) {
    const error = graded.errors.get(answer.id);
    if (error === undefined) continue;
    failuresByIndex.set(answer.index, {
      index: answer.index,
      id: answer.id,
      phase: "grading",
      error,
      recorded: false,
    });
  }
  const gradeById = graded.grades;

  const gradedAnswers = gradableAnswers.filter((answer) => gradeById.has(answer.id));
  const batchArgById = new Map(gradedAnswers.map((answer) => {
    const grade = gradeById.get(answer.id)!;
    return [answer.id, {
      id: answer.id,
      quality: grade.quality,
      verdict: grade.verdict,
      note: grade.note,
      format: answer.format,
      attempt_id: answer.attempt_id,
    }];
  }));
  const recordedById = new Map<string, RecordedState>();
  if (gradedAnswers.length > 0) {
    const gradedIds = gradedAnswers.map((answer) => answer.id);
    const batchArgs = gradedIds.map((id) => batchArgById.get(id)!);
    const recorded = await requestSupabaseFunction(context.env, "record_answers_batch_once", {
      p_answers: batchArgs,
    });
    if (recorded.ok) {
      for (const [id, state] of parseRecordedRows(recorded.data, new Set(gradedIds))) {
        recordedById.set(id, state);
      }
    }

    const unresolvedIds = gradedIds.filter((id) => !recordedById.has(id));
    for (const id of unresolvedIds) {
      // 一括記録が失敗・不完全でも、同じattempt_idで1問ずつ再実行する。
      // DB側の一意制約により、応答だけ失われた場合も二重記録せず成否を回収できる。
      const single = await requestSupabaseFunction(context.env, "record_answers_batch_once", {
        p_answers: [batchArgById.get(id)!],
      });
      if (single.ok) {
        const row = parseRecordedRows(single.data, new Set([id])).get(id);
        if (row) {
          recordedById.set(id, row);
          continue;
        }
      }
      const answer = gradedAnswers.find((item) => item.id === id)!;
      failuresByIndex.set(answer.index, {
        index: answer.index,
        id,
        phase: "recording",
        error: single.ok
          ? "DBの記録結果を確認できませんでした。"
          : await responseError(single.response, "DBへの採点記録に失敗しました。"),
        recorded: null,
      });
    }
  }

  const recordedIds = gradedAnswers
    .filter((answer) => recordedById.has(answer.id))
    .map((answer) => answer.id);

  if (recordedIds.length === 0) return finish([]);

  // record_answerで版番号と復習日が変わるため、優先度編集に使う最新状態を読み直す。
  const reviewStateSelect = "id,title,mastery,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage";
  const reviewStateResult = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({
      id: inFilter(recordedIds),
      select: reviewStateSelect,
    }),
  });
  const reviewStates = reviewStateResult.ok
    ? reviewStateResult.rows.filter(isKnowledgeReviewState)
    : [];
  const reviewStateById = new Map(reviewStates.map((state) => [state.id, state]));
  for (const id of recordedIds.filter((itemId) => !reviewStateById.has(itemId))) {
    const singleState = await requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ id: `eq.${id}`, select: reviewStateSelect }),
    });
    if (!singleState.ok) continue;
    const state = singleState.rows.find(
      (row): row is KnowledgeReviewState => isKnowledgeReviewState(row) && row.id === id,
    );
    if (state) reviewStateById.set(id, state);
  }
  const missingStateIds = recordedIds.filter((id) => !reviewStateById.has(id));
  for (const id of missingStateIds) {
    const answer = gradedAnswers.find((item) => item.id === id)!;
    failuresByIndex.set(answer.index, {
      index: answer.index,
      id,
      phase: "confirmation",
      error: reviewStateResult.ok
        ? "採点は保存済みですが、採点後の状態を確認できませんでした。"
        : `${await responseError(reviewStateResult.response, "採点後の状態を取得できませんでした。")} 採点結果は保存済みです。`,
      recorded: true,
    });
  }

  const resultIds = recordedIds.filter((id) => reviewStateById.has(id));
  const results = resultIds.map((id) => {
    const grade = gradeById.get(id)!;
    const fact = factById.get(id)!;
    const recorded = recordedById.get(id);
    const state = reviewStateById.get(id)!;
    return {
      id,
      title: state.title,
      category: fact.category,
      mastery: state.mastery,
      priority: state.priority,
      content_version: state.content_version,
      verdict: grade.verdict,
      quality: grade.quality,
      correct_answer: grade.correctAnswer,
      explanation: grade.explanation,
      next_review_on: state.next_review_on,
      next_review_at: state.next_review_at,
      stability_hours: state.stability_hours,
      relearning_stage: state.relearning_stage,
      schedule_updated: recorded?.schedule_updated ?? false,
      recorded: recorded?.recorded ?? false,
    };
  });

  return finish(results);
};
