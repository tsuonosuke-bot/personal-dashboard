import { runGradingBatch } from "../../_shared/reviewBatch.ts";
import { handleBatch, type BatchContext } from "../../_shared/reviewBatchHandler.ts";

/** 15分ごと、または画面からの手動の採点バッチ。採点待ちがなければAIを呼ばない。 */
export const onRequest = (context: BatchContext): Promise<Response> =>
  handleBatch(context, runGradingBatch);
