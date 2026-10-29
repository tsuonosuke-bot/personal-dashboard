import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";
import {
  GROUP_SELECT,
  readGroupDelete,
  readGroupId,
  readGroupUpdate,
  validateGroupRequest,
} from "../../_shared/insightGroupValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
  params: { id?: string | string[] };
}

async function missingOrConflict(env: SupabaseEnv, id: number): Promise<Response> {
  const existing = await requestSupabaseRows(env, {
    table: "insight_groups",
    params: new URLSearchParams({ select: "id", id: `eq.${id}`, limit: "1" }),
  });
  if (!existing.ok) return existing.response;
  return existing.rows.length === 0
    ? jsonResponse({ error: "対象のグループが見つかりません。" }, 404)
    : jsonResponse({ error: "別の画面でグループが更新されています。最新データを再読み込みしてください。" }, 409);
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method !== "PATCH" && method !== "DELETE") return methodNotAllowed("PATCH, DELETE");
  const id = readGroupId(context.params.id);
  if (!id) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);
  const guard = validateGroupRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);

  if (method === "PATCH") {
    const input = await readGroupUpdate(context.request);
    if (!input.ok) return jsonResponse({ error: input.error }, input.status);
    const updated = await requestSupabaseRows(context.env, {
      table: "insight_groups",
      method: "PATCH",
      params: new URLSearchParams({
        id: `eq.${id}`,
        updated_at: `eq.${input.value.expectedUpdatedAt}`,
        select: GROUP_SELECT,
      }),
      body: { title: input.value.title, guiding_question: input.value.guidingQuestion },
    });
    if (!updated.ok) return updated.response;
    if (updated.rows.length === 0) return missingOrConflict(context.env, id);
    if (updated.rows.length !== 1) return jsonResponse({ error: "更新対象を一意に確認できませんでした。" }, 409);
    return jsonResponse(updated.rows[0]);
  }

  const input = await readGroupDelete(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);
  const deleted = await requestSupabaseRows(context.env, {
    table: "insight_groups",
    method: "DELETE",
    params: new URLSearchParams({
      id: `eq.${id}`,
      updated_at: `eq.${input.value.expectedUpdatedAt}`,
      select: "id",
    }),
  });
  if (!deleted.ok) return deleted.response;
  if (deleted.rows.length === 0) return missingOrConflict(context.env, id);
  if (deleted.rows.length !== 1) return jsonResponse({ error: "削除対象を一意に確認できませんでした。" }, 409);
  return jsonResponse({ id });
};
