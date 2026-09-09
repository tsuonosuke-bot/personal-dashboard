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
  select:
    "id,title,explanation,category,mastery,tags,accuracy,next_review_on,archived,created_at",
  archived: "eq.false",
  order: "created_at.desc",
  limit: "2000",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed();
  return fetchSupabaseRows(context.env, { table: "knowledge", params });
};
