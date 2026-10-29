import { callRpc, isRecord, readItemId, readReviewJson, validateReviewQueueRequest } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** 採点エラーになった回答を、採点待ちへ戻して次の採点で再試行させる。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const id = readItemId(isRecord(json.value) ? json.value.id : null);
  if (id === null) return jsonResponse({ error: "idを指定してください。" }, 400);
  try {
    const status = await callRpc(context.env, "retry_review_answer", { p_item_id: id });
    if (status !== "answered") return jsonResponse({ error: "採点エラーの回答ではありません。" }, 409);
    return jsonResponse({ id, status });
  } catch {
    return jsonResponse({ error: "再採点の準備ができませんでした。" }, 502);
  }
};
