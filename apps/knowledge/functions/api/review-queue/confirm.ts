import { callRpc, isRecord, readItemId, readReviewJson, validateReviewQueueRequest } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const MAX_CONFIRM_IDS = 200;

/** 学習ログで見た採点結果を確認済みにする。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const raw = isRecord(json.value) ? json.value.quiz_log_ids : null;
  const ids = Array.isArray(raw) ? raw.map(readItemId) : [];
  if (ids.length === 0 || ids.length > MAX_CONFIRM_IDS || ids.some((id) => id === null)) {
    return jsonResponse({ error: `quiz_log_idsに1〜${MAX_CONFIRM_IDS}件のIDを指定してください。` }, 400);
  }
  try {
    const confirmed = await callRpc(context.env, "confirm_review_results", { p_quiz_log_ids: ids });
    return jsonResponse({ confirmed: typeof confirmed === "number" ? confirmed : 0 });
  } catch {
    return jsonResponse({ error: "確認済みにできませんでした。" }, 502);
  }
};
