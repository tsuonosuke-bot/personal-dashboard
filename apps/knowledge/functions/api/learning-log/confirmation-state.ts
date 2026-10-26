import { inFilter, jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const ids = new URL(request.url).searchParams.get("ids")?.split(",") ?? [];
  if (!ids.length || ids.length > 200 || ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    return jsonResponse({ error: "1〜200件の履歴IDを指定してください。" }, 400);
  }
  const result = await requestSupabaseRows(env, { table: "quiz_log", count: "exact", params: new URLSearchParams({
    select: "id,review_queue_id,confirmed_at", id: inFilter([...new Set(ids)]), limit: "200",
  }) });
  if (!result.ok) return result.response;
  if (result.total === null || result.rows.length !== result.total) return jsonResponse({ error: "確認状態を全件取得できませんでした。" }, 502);
  return jsonResponse(result.rows);
}
