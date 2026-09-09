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
  select: "id,knowledge_id,asked_on,verdict",
  order: "asked_on.asc",
  limit: "5000",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed();
  return fetchSupabaseRows(context.env, { table: "quiz_log", params });
};
