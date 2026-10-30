import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import { INSIGHT_SELECT, readInsightCreate, validateInsightRequest } from "../_shared/insightValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    return fetchSupabasePage(
      context.env,
      { table: "knowledge_insights", params: new URLSearchParams({ select: INSIGHT_SELECT, order: "created_at.desc,id.desc" }) },
      pagination.value,
    );
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guard = validateInsightRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readInsightCreate(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);

  const source = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({ select: "id", id: `eq.${input.value.knowledgeId}`, limit: "1" }),
  });
  if (!source.ok) return source.response;
  if (source.rows.length === 0) return jsonResponse({ error: "対象のナレッジが見つかりません。" }, 404);

  const inserted = await requestSupabaseRows(context.env, {
    table: "knowledge_insights",
    method: "POST",
    params: new URLSearchParams({ select: INSIGHT_SELECT }),
    body: { knowledge_id: input.value.knowledgeId, body: input.value.body },
  });
  if (!inserted.ok) return inserted.response;
  if (inserted.rows.length !== 1) return jsonResponse({ error: "示唆の保存結果を確認できませんでした。" }, 502);
  return jsonResponse(inserted.rows[0], 201);
};
