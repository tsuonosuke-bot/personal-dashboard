import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import { MEMBER_SELECT, readMemberChange, validateGroupRequest } from "../_shared/insightGroupValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    return fetchSupabasePage(context.env, {
      table: "insight_group_members",
      params: new URLSearchParams({ select: MEMBER_SELECT, order: "group_id.asc,insight_id.asc" }),
    }, pagination.value);
  }
  if (method !== "POST" && method !== "DELETE") return methodNotAllowed("GET, POST, DELETE");
  const guard = validateGroupRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readMemberChange(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);
  const { groupId, insightId } = input.value;
  const pair = new URLSearchParams({
    group_id: `eq.${groupId}`,
    insight_id: `eq.${insightId}`,
    select: MEMBER_SELECT,
  });

  if (method === "DELETE") {
    const removed = await requestSupabaseRows(context.env, {
      table: "insight_group_members", method: "DELETE", params: pair,
    });
    if (!removed.ok) return removed.response;
    if (removed.rows.length === 0) return jsonResponse({ error: "対象の所属が見つかりません。" }, 404);
    return jsonResponse({ group_id: groupId, insight_id: insightId });
  }

  const [group, insight] = await Promise.all([
    requestSupabaseRows(context.env, {
      table: "insight_groups",
      params: new URLSearchParams({ select: "id", id: `eq.${groupId}`, limit: "1" }),
    }),
    requestSupabaseRows(context.env, {
      table: "knowledge_insights",
      params: new URLSearchParams({ select: "id", id: `eq.${insightId}`, limit: "1" }),
    }),
  ]);
  if (!group.ok) return group.response;
  if (!insight.ok) return insight.response;
  if (group.rows.length === 0) return jsonResponse({ error: "対象のグループが見つかりません。" }, 404);
  if (insight.rows.length === 0) return jsonResponse({ error: "対象の示唆が見つかりません。" }, 404);

  const existing = await requestSupabaseRows(context.env, {
    table: "insight_group_members", params: new URLSearchParams({ ...Object.fromEntries(pair), limit: "1" }),
  });
  if (!existing.ok) return existing.response;
  if (existing.rows.length === 1) return jsonResponse(existing.rows[0]);

  const inserted = await requestSupabaseRows(context.env, {
    table: "insight_group_members",
    method: "POST",
    params: new URLSearchParams({ select: MEMBER_SELECT, on_conflict: "group_id,insight_id" }),
    body: { group_id: groupId, insight_id: insightId },
    preferResolution: "ignore-duplicates",
  });
  if (!inserted.ok) return inserted.response;
  if (inserted.rows.length === 0) return jsonResponse({ group_id: groupId, insight_id: insightId });
  if (inserted.rows.length !== 1) return jsonResponse({ error: "示唆の所属を確認できませんでした。" }, 502);
  return jsonResponse(inserted.rows[0], 201);
};
