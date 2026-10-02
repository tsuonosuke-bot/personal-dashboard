import { runGenerationBatch } from "../../_shared/reviewBatch.ts";
import { handleBatch, type BatchContext } from "../../_shared/reviewBatchHandler.ts";

/** 30分ごとの出題生成バッチ。キューが上限ならAIを呼ばない。 */
export const onRequest = (context: BatchContext): Promise<Response> =>
  handleBatch(context, (env, trigger) => runGenerationBatch(env, trigger));
