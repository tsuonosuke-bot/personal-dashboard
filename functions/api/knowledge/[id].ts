import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  isUuid,
  readJsonBody,
  validateKnowledgeInput,
  validateMutationRequest,
} from "../../_shared/knowledgeValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
  params: { id?: string | string[] };
}

const SELECT_COLUMNS =
  "id,title,explanation,source_note,category,mastery,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,archived,created_at,accuracy,tags,mastery_streak";

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "PATCH") return methodNotAllowed("PATCH");
  const rawId = context.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id || !isUuid(id)) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);

  const guardError = validateMutationRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateKnowledgeInput(json.value, "update");
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const params = new URLSearchParams({ id: `eq.${id}`, select: SELECT_COLUMNS });
  const result = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params,
    method: "PATCH",
    body: validated.value,
  });
  if (!result.ok) return result.response;
  if (result.rows.length === 0) return jsonResponse({ error: "対象のナレッジが見つかりません。" }, 404);
  if (result.rows.length !== 1) return jsonResponse({ error: "更新対象を一意に確認できませんでした。" }, 409);
  return jsonResponse(result.rows[0]);
};
