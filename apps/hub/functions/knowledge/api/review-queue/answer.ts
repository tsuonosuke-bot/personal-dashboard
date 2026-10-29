import { instantGrade, isKnowledgeFact } from "../../_shared/answerGrading.ts";
import { MAX_ANSWER_CHARS, QUIZ_FORMATS, type QuizFormat } from "../../_shared/quizValidation.ts";
import {
  callRpc,
  firstRow,
  isRecord,
  readItemId,
  readReviewJson,
  validateReviewQueueRequest,
} from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/**
 * 回答を受け付ける。四択と無回答はAIを呼ばずにその場で記録して結果を返し、
 * それ以外は採点待ちにする。同じ回答の再送は二重に扱わない。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const body = isRecord(json.value) ? json.value : null;
  const id = readItemId(body?.id);
  const answer = body?.answer;
  if (id === null || typeof answer !== "string" || answer.length > MAX_ANSWER_CHARS) {
    return jsonResponse({ error: `idと${MAX_ANSWER_CHARS}文字以内の回答を指定してください。` }, 400);
  }

  let row: Record<string, unknown> | null;
  try {
    row = firstRow(await callRpc(context.env, "submit_review_answer", { p_item_id: id, p_answer: answer }));
  } catch {
    return jsonResponse({
      error: "回答を受け付けられませんでした。問題が古くなったか、すでに別の回答を送っています。",
    }, 409);
  }
  if (!row || typeof row.status !== "string" || typeof row.knowledge_id !== "string"
    || typeof row.format !== "string" || !(QUIZ_FORMATS as readonly string[]).includes(row.format)) {
    return jsonResponse({ error: "回答の受付結果を確認できませんでした。" }, 502);
  }
  // 想定解は回答を受け付けた後にだけ返す。AIの採点を待たずに答え合わせできるようにするため。
  const expectedAnswer = typeof row.expected_answer === "string" ? row.expected_answer : null;
  if (row.status !== "answered") return jsonResponse({ id, status: row.status, expected_answer: expectedAnswer });

  // AIを呼ばずに確定できる回答だけ、その場で記録する。失敗しても採点バッチが拾う。
  const knowledge = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({
      id: `eq.${row.knowledge_id}`,
      select: "id,title,explanation,category,tags,archived",
      limit: "1",
    }),
  });
  const fact = knowledge.ok ? knowledge.rows.find(isKnowledgeFact) : undefined;
  const grade = fact ? instantGrade({
    fact,
    format: row.format as QuizFormat,
    answer: typeof row.answer_text === "string" ? row.answer_text : answer.trim(),
    correctChoice: typeof row.correct_choice === "string" ? row.correct_choice : null,
    preparedExplanation: typeof row.prepared_explanation === "string" ? row.prepared_explanation : null,
  }) : null;
  if (!grade) return jsonResponse({ id, status: "answered", expected_answer: expectedAnswer });

  try {
    const recorded = firstRow(await callRpc(context.env, "record_review_grade", {
      p_item_id: id,
      p_quality: grade.quality,
      p_verdict: grade.verdict,
      p_note: grade.note,
      p_correct_answer: grade.correctAnswer,
      p_explanation: grade.explanation,
    }));
    if (recorded?.status !== "graded") {
      return jsonResponse({ id, status: recorded?.status ?? "answered", expected_answer: expectedAnswer });
    }
    return jsonResponse({
      id,
      status: "graded",
      expected_answer: expectedAnswer,
      result: {
        quiz_log_id: recorded.quiz_log_id,
        quality: grade.quality,
        verdict: grade.verdict,
        correct_answer: grade.correctAnswer,
        explanation: grade.explanation,
        next_review_at: recorded.next_review_at,
      },
    });
  } catch {
    return jsonResponse({ id, status: "answered", expected_answer: expectedAnswer });
  }
};
