import { useCallback, useEffect, useRef, useState } from "react";
import { getCardMasteryHistory } from "../lib/api";
import { knowledgeMasteryChanges } from "../lib/knowledgeReviewHistory";

export function useCardMasteryHistory(knowledgeId: string, enabled: boolean, reloadKey: unknown) {
  const [changes, setChanges] = useState<ReturnType<typeof knowledgeMasteryChanges>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const offset = useRef(0);
  const load = useCallback(async () => {
    if (!enabled || busy.current) return;
    const token = generation.current;
    const start = offset.current;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await getCardMasteryHistory(knowledgeId, start);
      if (token !== generation.current) return;
      const next = knowledgeMasteryChanges([...page.items, ...(page.previous ? [page.previous] : [])], knowledgeId)
        .filter((entry) => page.items.some((item) => item.id === entry.id));
      setChanges((current) => start === 0 ? next : [...current, ...next]);
      offset.current = start + page.items.length;
      setTotal(page.total);
    } catch (caught) {
      if (token === generation.current) setError(caught instanceof Error ? caught.message : "習熟度の履歴を取得できませんでした。");
    } finally {
      if (token === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [enabled, knowledgeId]);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    offset.current = 0;
    setChanges([]);
    setTotal(0);
    setError(null);
    setLoading(false);
    if (enabled) void load();
    return () => { generation.current++; busy.current = false; };
  }, [knowledgeId, enabled, reloadKey, load]);
  return { changes, total, loading, error, load };
}
