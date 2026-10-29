import { callRpc, isRecord, readItemId, readReviewJson, validateReviewQueueRequest } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

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
    const requested = [...new Set(ids as number[])];
    const confirmed = await callRpc(context.env, "confirm_review_results", { p_quiz_log_ids: requested });
    if (!Number.isSafeInteger(confirmed) || (confirmed as number) < 0 || (confirmed as number) > requested.length) {
      throw new Error("Invalid confirmation count");
    }
    // 他画面で既に確認されたものも含め、現在のDBの状態を確認する。
    const loaded = await requestSupabaseRows(context.env, {
      table: "quiz_log",
      params: new URLSearchParams({
        select: "id,confirmed_at,review_queue_id", id: `in.(${requested.join(",")})`, limit: String(MAX_CONFIRM_IDS),
      }),
    });
    if (!loaded.ok) return loaded.response;
    const seen = new Set<number>();
    const confirmedIds: number[] = [];
    for (const row of loaded.rows) {
      if (!isRecord(row) || readItemId(row.id) === null || !requested.includes(row.id as number)
        || seen.has(row.id as number)
        || (row.review_queue_id !== null && readItemId(row.review_queue_id) === null)
        || (row.confirmed_at !== null && (typeof row.confirmed_at !== "string"
          || !Number.isFinite(Date.parse(row.confirmed_at))))) throw new Error("Invalid confirmation row");
      seen.add(row.id as number);
      if (row.review_queue_id !== null && row.confirmed_at !== null) confirmedIds.push(row.id as number);
    }
    return jsonResponse({ confirmed, confirmedIds });
  } catch {
    return jsonResponse({ error: "確認済みにできませんでした。" }, 502);
  }
};
