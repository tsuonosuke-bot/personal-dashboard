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
  select: "id,knowledge_id,to_mastery,is_baseline,changed_at",
  order: "changed_at.asc,id.asc",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const pagination = readPagination(context.request);
  if (!pagination.ok) return pagination.response;
  return fetchSupabasePage(
    context.env,
    { table: "knowledge_mastery_history", params },
    pagination.value,
  );
};
