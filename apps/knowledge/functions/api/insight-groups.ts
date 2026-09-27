import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import { GROUP_SELECT, readGroupCreate, validateGroupRequest } from "../_shared/insightGroupValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    return fetchSupabasePage(context.env, {
      table: "insight_groups",
      params: new URLSearchParams({ select: GROUP_SELECT, order: "created_at.asc,id.asc" }),
    }, pagination.value);
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guard = validateGroupRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readGroupCreate(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);

  const inserted = await requestSupabaseRows(context.env, {
    table: "insight_groups",
    method: "POST",
    params: new URLSearchParams({ select: GROUP_SELECT }),
    body: { title: input.value.title, guiding_question: input.value.guidingQuestion },
  });
  if (!inserted.ok) return inserted.response;
  if (inserted.rows.length !== 1) return jsonResponse({ error: "グループの保存結果を確認できませんでした。" }, 502);
  return jsonResponse(inserted.rows[0], 201);
};
