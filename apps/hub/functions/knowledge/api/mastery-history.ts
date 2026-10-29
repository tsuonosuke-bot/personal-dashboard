import {
  fetchSupabasePage,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  jsonResponse,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const params = new URLSearchParams({
  select: "id,knowledge_id,to_mastery,is_baseline,changed_at",
  order: "changed_at.asc,id.asc",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const pagination = readPagination(context.request);
  if (!pagination.ok) return pagination.response;
  const knowledgeId = new URL(context.request.url).searchParams.get("knowledge_id");
  if (knowledgeId !== null) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(knowledgeId)) {
      return jsonResponse({ error: "ナレッジIDが正しくありません。" }, 400);
    }
    if (pagination.value.limit > 10) return jsonResponse({ error: "カードの履歴は10件ずつ取得してください。" }, 400);
    const result = await requestSupabaseRows(context.env, {
      table: "knowledge_mastery_history", count: "exact",
      params: new URLSearchParams({
        select: params.get("select")!, knowledge_id: `eq.${knowledgeId}`,
        order: "changed_at.desc,id.desc", offset: String(pagination.value.offset),
        // One predecessor supplies the value before the last change on this page.
        limit: String(pagination.value.limit + 1),
      }),
    });
    if (!result.ok) return result.response;
    return jsonResponse({ ...pagination.value, total: result.total,
      items: result.rows.slice(0, pagination.value.limit), previous: result.rows[pagination.value.limit] ?? null });
  }
  return fetchSupabasePage(
    context.env,
    { table: "knowledge_mastery_history", params },
    pagination.value,
  );
};
