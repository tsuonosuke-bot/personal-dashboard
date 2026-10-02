import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** 採点待ち・採点中・採点エラーの回答を、新しい順に返す。正解の選択肢は返さない。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const result = await requestSupabaseRows(context.env, {
    table: "review_queue",
    params: new URLSearchParams({
      select: "id,knowledge_id,format,question,answer_text,answered_at,status,last_error,grade_attempts",
      status: "in.(answered,grading,error)",
      order: "answered_at.desc,id.desc",
      limit: "200",
    }),
  });
  if (!result.ok) return result.response;
  return jsonResponse({ items: result.rows });
};
