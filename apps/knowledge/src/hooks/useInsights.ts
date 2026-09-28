import { useCallback, useEffect, useMemo, useState } from "react";
import { createInsight, deleteInsight, getInsights, updateInsight } from "../lib/api";
import type { KnowledgeInsight } from "../types";

export interface InsightStore {
  insights: KnowledgeInsight[];
  byKnowledge: ReadonlyMap<string, KnowledgeInsight[]>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (knowledgeId: string, body: string) => Promise<KnowledgeInsight>;
  update: (insight: KnowledgeInsight, body: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

function newestFirst(items: KnowledgeInsight[]): KnowledgeInsight[] {
  return [...items].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

export function useInsights(): InsightStore {
  const [insights, setInsights] = useState<KnowledgeInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInsights(newestFirst(await getInsights()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "示唆を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(async (knowledgeId: string, body: string) => {
    const created = await createInsight(knowledgeId, body);
    setInsights((current) => newestFirst([created, ...current]));
    return created;
  }, []);

  const update = useCallback(async (insight: KnowledgeInsight, body: string) => {
    const updated = await updateInsight(insight, body);
    setInsights((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, []);

  const remove = useCallback(async (id: number) => {
    await deleteInsight(id);
    setInsights((current) => current.filter((item) => item.id !== id));
  }, []);

  const byKnowledge = useMemo(() => {
    const map = new Map<string, KnowledgeInsight[]>();
    for (const insight of insights) map.set(insight.knowledge_id, [...(map.get(insight.knowledge_id) ?? []), insight]);
    return map;
  }, [insights]);

  return { insights, byKnowledge, loading, error, reload, create, update, remove };
}
