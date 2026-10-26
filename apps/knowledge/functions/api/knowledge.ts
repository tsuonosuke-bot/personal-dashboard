import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  requestSupabaseFunction,
  inFilter,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import {
  readJsonBody,
  validateKnowledgeInput,
  validateMutationRequest,
} from "../_shared/knowledgeValidation.ts";
import { isUuid } from "../_shared/learningReads.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const SELECT_COLUMNS =
  "id,title,explanation,source_note,claim_evidence,category,knowledge_kind,mastery,priority,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,next_review_at,stability_hours,relearning_stage,last_reviewed_at,archived,created_at,accuracy,tags,mastery_streak,content_version";

function readArchiveStatus(request: Request): "active" | "archived" | "all" | null {
  try {
    const status = new URL(request.url).searchParams.get("status") ?? "active";
    return status === "active" || status === "archived" || status === "all" ? status : null;
  } catch {
    return null;
  }
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    const status = readArchiveStatus(context.request);
    if (!status) return jsonResponse(
      { error: "statusはactive、archived、allのいずれかで指定してください。" },
      400,
    );
    const search = new URL(context.request.url).searchParams.get("search");
    if (status === "archived" && search !== null) {
      if (search.length > 500 || pagination.value.limit > 200) return jsonResponse({ error: "検索条件が正しくありません。" }, 400);
      const result = await requestSupabaseFunction(context.env, "search_archived_knowledge", {
        p_search: search, p_limit: pagination.value.limit, p_offset: pagination.value.offset,
      });
      return result.ok ? jsonResponse(result.data) : result.response;
    }
    const params = new URLSearchParams({
      select: SELECT_COLUMNS,
      order: "created_at.desc,id.asc",
    });
    const ids = new URL(context.request.url).searchParams.get("ids")?.split(",");
    if (ids) {
      if (ids.length > 100 || ids.some((id) => !isUuid(id))) return jsonResponse({ error: "ナレッジIDが正しくありません。" }, 400);
      params.set("id", inFilter([...new Set(ids)]));
    }
    if (status !== "all") params.set("archived", status === "archived" ? "eq.true" : "eq.false");
    return fetchSupabasePage(
      context.env,
      { table: "knowledge", params },
      pagination.value,
    );
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guardError = validateMutationRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateKnowledgeInput(json.value, "create");
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const createParams = new URLSearchParams({ select: SELECT_COLUMNS });
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
