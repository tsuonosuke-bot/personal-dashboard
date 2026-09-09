import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import {
  readJsonBody,
  validateKnowledgeInput,
  validateMutationRequest,
} from "../_shared/knowledgeValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const SELECT_COLUMNS =
  "id,title,explanation,source_note,category,mastery,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,archived,created_at,accuracy,tags,mastery_streak";

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
    const params = new URLSearchParams({
      select: SELECT_COLUMNS,
      order: "created_at.desc,id.asc",
    });
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
