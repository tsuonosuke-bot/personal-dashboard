import { isDate } from "../_shared/learningReads.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseFunction, type SupabaseEnv } from "../_shared/supabaseRest.ts";
export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const today = new URL(request.url).searchParams.get("today");
  if (today !== null && !isDate(today)) return jsonResponse({ error: "日付が正しくありません。" }, 400);
  const result = await requestSupabaseFunction(env, "get_knowledge_hub_summary", today ? { p_today: today } : {});
  return result.ok ? jsonResponse(result.data) : result.response;
}
