import {
  fetchSupabaseRows,
  methodNotAllowed,
  type SupabaseEnv,
} from "../_shared/supabaseRest";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const params = new URLSearchParams({
  select: "id,knowledge_id,asked_on,quality,verdict,format,note,created_at",
  order: "asked_on.asc",
  limit: "5000",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  return fetchSupabaseRows(context.env, { table: "quiz_log", params });
};
