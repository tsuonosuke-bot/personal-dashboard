import {
  fetchSupabaseRows,
  jsonResponse,
  methodNotAllowed,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest";
import {
  readJsonBody,
  validateKnowledgeInput,
  validateMutationRequest,
} from "../_shared/knowledgeValidation";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const params = new URLSearchParams({
  select:
    "id,title,explanation,source_note,category,mastery,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,archived,created_at,accuracy,tags,mastery_streak",
  archived: "eq.false",
  order: "created_at.desc",
  limit: "2000",
});

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    return fetchSupabaseRows(context.env, { table: "knowledge", params });
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guardError = validateMutationRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateKnowledgeInput(json.value, "create");
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const createParams = new URLSearchParams({ select: params.get("select") ?? "*" });
  const result = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: createParams,
    method: "POST",
    body: { ...validated.value, archived: false },
  });
  if (!result.ok) return result.response;
  if (result.rows.length !== 1) {
    return jsonResponse({ error: "登録結果を確認できませんでした。" }, 502);
  }
  return jsonResponse(result.rows[0], 201);
};
