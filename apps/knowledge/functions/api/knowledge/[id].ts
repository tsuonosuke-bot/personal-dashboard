import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  isUuid,
  readJsonBody,
  validateKnowledgeUpdateEnvelope,
  validateMutationRequest,
} from "../../_shared/knowledgeValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
  params: { id?: string | string[] };
}

const SELECT_COLUMNS =
  "id,title,explanation,source_note,category,mastery,priority,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,next_review_at,stability_hours,relearning_stage,last_reviewed_at,archived,created_at,accuracy,tags,mastery_streak,content_version";

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method !== "GET" && method !== "PATCH") return methodNotAllowed("GET, PATCH");
  const rawId = context.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id || !isUuid(id)) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);

  // 1件だけ最新版を取り直す。復習の記録でcontent_versionが進んだ後に、画面の版を追いつかせるため。
  if (method === "GET") {
    const found = await requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ id: `eq.${id}`, select: SELECT_COLUMNS, limit: "1" }),
    });
    if (!found.ok) return found.response;
    return found.rows.length === 1
      ? jsonResponse(found.rows[0])
      : jsonResponse({ error: "対象のナレッジが見つかりません。" }, 404);
  }

  const guardError = validateMutationRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateKnowledgeUpdateEnvelope(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const params = new URLSearchParams({
    id: `eq.${id}`,
    content_version: `eq.${validated.expectedVersion}`,
    select: SELECT_COLUMNS,
  });
  const result = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params,
    method: "PATCH",
    body: validated.changes,
  });
  if (!result.ok) return result.response;
  if (result.rows.length === 0) {
    const existing = await requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ id: `eq.${id}`, select: "id", limit: "1" }),
    });
    if (!existing.ok) return existing.response;
    return existing.rows.length === 0
      ? jsonResponse({ error: "対象のナレッジが見つかりません。" }, 404)
      : jsonResponse({ error: "別の画面で更新されています。最新データを再読み込みしてください。" }, 409);
  }
  if (result.rows.length !== 1) return jsonResponse({ error: "更新対象を一意に確認できませんでした。" }, 409);
  return jsonResponse(result.rows[0]);
};
