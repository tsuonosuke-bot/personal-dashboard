import {
  fetchSupabasePage,
  methodNotAllowed,
  readPagination,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const params = new URLSearchParams({
  select: "id,knowledge_id,asked_on,quality,verdict,format,note,created_at,question,user_answer,correct_answer,explanation,answered_at,confirmed_at,review_queue_id",
  order: "asked_on.desc,created_at.desc,id.desc",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const pagination = readPagination(context.request);
  if (!pagination.ok) return pagination.response;
  return fetchSupabasePage(
    context.env,
    { table: "quiz_log", params },
    pagination.value,
  );
};
