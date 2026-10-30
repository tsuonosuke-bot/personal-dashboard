import { readPositiveId, validateGroupRequest } from "../../_shared/insightGroupValidation.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseFunction, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateGroupRequest(request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4_000) return jsonResponse({ error: "リクエストが大きすぎます。" }, 413);
    body = JSON.parse(text);
  } catch { return jsonResponse({ error: "JSON形式が正しくありません。" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "入力が正しくありません。" }, 400);
  const input = body as Record<string, unknown>;
  const groupId = readPositiveId(input.group_id);
  const expected = input.expected_updated_at;
  if (Object.keys(input).length !== 3 || typeof expected !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(expected)
    || !Number.isFinite(Date.parse(expected)) || !groupId || !Array.isArray(input.insight_ids)
    || input.insight_ids.length < 1 || input.insight_ids.length > 100
    || input.insight_ids.some((id) => !readPositiveId(id))) {
    return jsonResponse({ error: "グループIDと1〜100件の示唆IDを指定してください。" }, 400);
  }
  const result = await requestSupabaseFunction(env, "add_insight_group_members", {
    p_group_id: groupId, p_insight_ids: [...new Set(input.insight_ids.map(readPositiveId))], p_expected_updated_at: expected,
  });
  if (!result.ok) return result.response;
  if (!result.data || typeof result.data !== "object") return jsonResponse({ error: "所属を確認できませんでした。" }, 502);
  if ((result.data as Record<string, unknown>).group === null) return jsonResponse({ error: "対象のグループが見つかりません。" }, 404);
  if ((result.data as Record<string, unknown>).conflict === true) return jsonResponse({ error: "問いが更新されています。再読み込みしてから追加してください。" }, 409);
  return jsonResponse(result.data);
}
