import { readReviewJson, validateReviewQueueRequest } from "../_shared/reviewQueue.ts";
import { readSearchRequest, searchSemantic, SEMANTIC_SEARCH_ACTION } from "../_shared/semanticSearch.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../_shared/supabaseRest.ts";
import type { VoyageEnv } from "../_shared/voyageClient.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & VoyageEnv;
}

/** ナレッジ・示唆・日記を意味で横断検索する。検索語はURLやログに残さないようPOSTの本文で受け取る。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request, SEMANTIC_SEARCH_ACTION);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const parsed = readSearchRequest(json.value);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  try {
    const result = await searchSemantic(context.env, parsed.value);
    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse({ results: result.results });
  } catch (error) {
    console.error("Semantic search failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "検索できませんでした。" }, 502);
  }
};
