import { learningFilters } from "../_shared/learningReads.ts";
import { jsonResponse, methodNotAllowed, readPagination, requestSupabaseFunction, type SupabaseEnv } from "../_shared/supabaseRest.ts";

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const filters = learningFilters(request);
  if (!filters.ok) return filters.response;
  const idsOnly = new URL(request.url).searchParams.get("ids") === "true";
  const pagination = readPagination(request);
  if (!pagination.ok) return pagination.response;
  if (!idsOnly && pagination.value.limit > 200) return jsonResponse({ error: "履歴は200件以下ずつ取得してください。" }, 400);
  const result = await requestSupabaseFunction(env, idsOnly ? "snapshot_review_result_ids" : "get_learning_log_page",
    idsOnly ? { p_from: filters.value.p_from, p_category: filters.value.p_category, p_verdict: filters.value.p_verdict, p_misses: filters.value.p_misses }
      : { ...filters.value, p_limit: pagination.value.limit, p_offset: pagination.value.offset });
  return result.ok ? jsonResponse(result.data) : result.response;
}
