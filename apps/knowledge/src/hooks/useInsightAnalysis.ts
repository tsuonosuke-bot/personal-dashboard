import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeInsights, ApiError, getInsightAnalysis } from "../lib/api";
import { insightAnalysisRequests } from "../lib/insightAnalysisRequests";
import type { InsightAnalysis, Knowledge, KnowledgeInsight } from "../types";

/** 保存済みのまとめを読むだけではAIを呼ばない。内容が変わったら古い表示を即座に外す。 */
export function useInsightAnalysis(insights: KnowledgeInsight[], knowledge: Knowledge[], ready: boolean) {
  const context = useMemo(() => {
    const sources = new Map(knowledge.map((item) => [item.id, item]));
    return JSON.stringify(insights.map((item) => [item.id, item.knowledge_id, item.body,
      sources.get(item.knowledge_id)?.title, sources.get(item.knowledge_id)?.category]));
  }, [insights, knowledge]);
  const [result, setResult] = useState<{ context: string; analysis: InsightAnalysis | null }>({ context: "", analysis: null });
  const [checking, setChecking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const request = ++revision.current;
    const pending = insightAnalysisRequests.get(context);
    busy.current = Boolean(pending);
    setAnalyzing(Boolean(pending));
    setError(null);
    setResult({ context, analysis: null });
    if (!ready || insights.length < 2) { setChecking(false); return; }
    setChecking(!pending);
    void (pending ?? getInsightAnalysis()).then((analysis) => {
      if (request === revision.current) setResult({ context, analysis });
    }).catch((caught) => {
      if (request === revision.current) setError(caught instanceof Error ? caught.message : "前回のまとめを読み込めませんでした。");
    }).finally(() => {
      if (request === revision.current) { busy.current = false; setChecking(false); setAnalyzing(false); }
    });
    return () => { revision.current += 1; };
  }, [context, ready, insights.length]);

  const analyze = async (force = false) => {
    if (busy.current || !ready) return;
    const request = ++revision.current;
    busy.current = true;
    setChecking(false);
    setAnalyzing(true);
    setError(null);
    try {
      const analysis = await insightAnalysisRequests.run(context, () => analyzeInsights(force));
      if (request === revision.current) setResult({ context, analysis });
    } catch (caught) {
      const detail = caught instanceof ApiError && caught.reason ? `（${caught.reason}）` : "";
      if (request === revision.current) setError(`${caught instanceof Error ? caught.message : "示唆をまとめられませんでした。"}${detail}`);
    } finally {
      if (request === revision.current) { busy.current = false; setAnalyzing(false); }
    }
  };
  return { analysis: ready && result.context === context ? result.analysis : null, checking, analyzing, error, analyze };
}
