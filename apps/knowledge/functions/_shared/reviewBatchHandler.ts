import type { AnthropicEnv } from "./anthropicClient.ts";
import type { BatchSummary, BatchTrigger } from "./reviewBatch.ts";
import {
  hasReviewBatchToken,
  validateReviewQueueRequest,
  type ReviewBatchEnv,
} from "./reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "./supabaseRest.ts";

export interface BatchContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv & ReviewBatchEnv;
}

/**
 * 生成・採点バッチの共通入口。定期実行は合言葉ヘッダーで、画面からの手動実行は
 * Basic認証済みの同一オリジン要求で受け付ける。
 */
export async function handleBatch(
  context: BatchContext,
  run: (env: BatchContext["env"], trigger: BatchTrigger) => Promise<BatchSummary>,
): Promise<Response> {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  let trigger: BatchTrigger;
  if (hasReviewBatchToken(context.request, context.env)) {
    trigger = "schedule";
  } else {
    const guard = validateReviewQueueRequest(context.request);
    if (guard) return guard;
    trigger = "manual";
  }
  try {
    return jsonResponse(await run(context.env, trigger));
  } catch (error) {
    console.error("Review batch failed to start", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "バッチを開始できませんでした。", reason: error instanceof Error ? error.message : null }, 502);
  }
}
