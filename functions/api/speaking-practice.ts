import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseFunction,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";
import {
  readSpeakingPracticeBody,
  validateSpeakingPracticeInput,
  validateSpeakingPracticeRequest,
} from "../_shared/speakingPracticeValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const SELECT_COLUMNS = "id,attempt_id,session_id,knowledge_id,practice_type,rating,answer_text,repetitions,practiced_at";

function readFrom(request: Request): string | null | undefined {
  let value: string | null;
  try {
    value = new URL(request.url).searchParams.get("from");
  } catch {
    return undefined;
  }
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? undefined : value;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    const from = readFrom(context.request);
    if (from === undefined) return jsonResponse(
      { error: "fromはISO 8601形式で指定してください。" },
      400,
    );
    const params = new URLSearchParams({
      select: SELECT_COLUMNS,
      order: "practiced_at.desc,id.desc",
    });
    if (from) params.set("practiced_at", `gte.${from}`);
    return fetchSupabasePage(
      context.env,
      { table: "speaking_practice_log", params },
      pagination.value,
    );
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guarded = validateSpeakingPracticeRequest(context.request);
  if (guarded) return guarded;
  const body = await readSpeakingPracticeBody(context.request);
  if (body instanceof Response) return body;
  const validated = validateSpeakingPracticeInput(body);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const input = validated.value;
  const result = await requestSupabaseFunction(context.env, "record_speaking_practice", {
    p_attempt_id: input.attempt_id,
    p_session_id: input.session_id,
    p_knowledge_id: input.knowledge_id,
    p_practice_type: input.practice_type,
    p_rating: input.rating,
    p_answer_text: input.answer_text,
    p_repetitions: input.repetitions,
  });
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    return jsonResponse({ error: "練習記録の保存結果を確認できませんでした。" }, 502);
  }
  return jsonResponse(result.data[0], 201);
};
