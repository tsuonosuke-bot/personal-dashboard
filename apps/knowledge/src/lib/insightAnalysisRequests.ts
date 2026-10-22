import type { InsightAnalysis } from "../types";

/** タブの切り替えでコンポーネントが消えても、実行中の同じ分析へ戻れるようにする。 */
export function createInsightAnalysisRequests() {
  const pending = new Map<string, Promise<InsightAnalysis>>();
  return {
    get: (context: string) => pending.get(context),
    run(context: string, load: () => Promise<InsightAnalysis>): Promise<InsightAnalysis> {
      const existing = pending.get(context);
      if (existing) return existing;
      const result = Promise.resolve().then(load);
      pending.set(context, result);
      const clear = () => { if (pending.get(context) === result) pending.delete(context); };
      void result.then(clear, clear);
      return result;
    },
  };
}

export const insightAnalysisRequests = createInsightAnalysisRequests();
