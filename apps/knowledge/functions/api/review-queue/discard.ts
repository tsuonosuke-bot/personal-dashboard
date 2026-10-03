import { callRpc, isRecord, readItemId, readReviewJson, validateReviewQueueRequest } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/**
 * 答えが問題文に出ているなど、おかしな問題を報告して捨てる。記録も予定の変更もせず、
 * 次の生成バッチで作り直される。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const id = readItemId(isRecord(json.value) ? json.value.id : null);
  if (id === null) return jsonResponse({ error: "idを指定してください。" }, 400);
  try {
    const status = await callRpc(context.env, "discard_review_question", { p_item_id: id });
    if (status !== "discarded") return jsonResponse({ error: "出題待ちの問題ではありません。" }, 409);
    return jsonResponse({ id, status });
  } catch {
    return jsonResponse({ error: "問題を取り下げられませんでした。" }, 502);
  }
};
