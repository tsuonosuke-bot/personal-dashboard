import { hasReviewBatchToken, validateReviewQueueRequest, type ReviewBatchEnv } from "../_shared/reviewQueue.ts";
import { runEmbeddingBatch, SEMANTIC_SEARCH_ACTION } from "../_shared/semanticSearch.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../_shared/supabaseRest.ts";
import type { VoyageEnv } from "../_shared/voyageClient.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & VoyageEnv & ReviewBatchEnv;
}

/**
 * ナレッジ・示唆・日記にembeddingを付けるバッチ。pg_cronからは1時間ごとに合言葉ヘッダーで、
 * 意味検索の画面からは「索引を更新」で呼ぶ。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  if (!hasReviewBatchToken(context.request, context.env)) {
    const guard = validateReviewQueueRequest(context.request, SEMANTIC_SEARCH_ACTION);
    if (guard) return guard;
  }
  try {
    return jsonResponse(await runEmbeddingBatch(context.env));
  } catch (error) {
    console.error("Embedding batch failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "embeddingのバッチを実行できませんでした。", reason: error instanceof Error ? error.message : null }, 502);
  }
};
