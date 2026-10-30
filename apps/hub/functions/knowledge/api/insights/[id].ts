import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";
import {
  INSIGHT_SELECT,
  readInsightId,
  readInsightUpdate,
  validateInsightRequest,
} from "../../_shared/insightValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
  params: { id?: string | string[] };
}

async function missingOrConflict(env: SupabaseEnv, id: number): Promise<Response> {
  const existing = await requestSupabaseRows(env, {
    table: "knowledge_insights",
    params: new URLSearchParams({ select: "id", id: `eq.${id}`, limit: "1" }),
  });
  if (!existing.ok) return existing.response;
  return existing.rows.length === 0
    ? jsonResponse({ error: "対象の示唆が見つかりません。" }, 404)
    : jsonResponse({ error: "別の画面で更新されています。最新データを再読み込みしてください。" }, 409);
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method !== "PATCH" && method !== "DELETE") return methodNotAllowed("PATCH, DELETE");
  const id = readInsightId(context.params.id);
  if (!id) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);
  const guard = validateInsightRequest(context.request, method === "PATCH");
  if (guard) return jsonResponse({ error: guard.error }, guard.status);

  if (method === "DELETE") {
    const deleted = await requestSupabaseRows(context.env, {
      table: "knowledge_insights",
      method: "DELETE",
      params: new URLSearchParams({ id: `eq.${id}`, select: "id" }),
    });
    if (!deleted.ok) return deleted.response;
    if (deleted.rows.length === 0) return jsonResponse({ error: "対象の示唆が見つかりません。" }, 404);
    return jsonResponse({ id });
  }

  const input = await readInsightUpdate(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);
  const updated = await requestSupabaseRows(context.env, {
    table: "knowledge_insights",
    method: "PATCH",
    params: new URLSearchParams({
      id: `eq.${id}`,
      updated_at: `eq.${input.value.expectedUpdatedAt}`,
      select: INSIGHT_SELECT,
    }),
    body: { body: input.value.body, updated_at: new Date().toISOString() },
  });
  if (!updated.ok) return updated.response;
  if (updated.rows.length === 0) return missingOrConflict(context.env, id);
  if (updated.rows.length !== 1) return jsonResponse({ error: "更新対象を一意に確認できませんでした。" }, 409);
  return jsonResponse(updated.rows[0]);
};
