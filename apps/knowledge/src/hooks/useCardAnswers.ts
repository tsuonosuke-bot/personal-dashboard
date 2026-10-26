import { useCallback, useEffect, useRef, useState } from "react";
import { getLearningLogPage } from "../lib/learningReadApi";
import type { QuizLog } from "../types";

export function useCardAnswers(knowledgeId: string, reloadKey: unknown) {
  const [items, setItems] = useState<QuizLog[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0), offset = useRef(0), busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    const token = generation.current, start = offset.current;
    busy.current = true; setLoading(true); setError(null);
    try {
      const page = await getLearningLogPage(new URLSearchParams({ knowledge_id: knowledgeId }), 10, start);
      if (token !== generation.current) return;
      setItems((current) => start === 0 ? page.items : [...current, ...page.items]);
      offset.current += page.items.length; setTotal(page.total);
    } catch (caught) { if (token === generation.current) setError(caught instanceof Error ? caught.message : "回答履歴を取得できませんでした。"); }
    finally { if (token === generation.current) { busy.current = false; setLoading(false); } }
  }, [knowledgeId]);
  useEffect(() => {
    generation.current++; offset.current = 0; busy.current = false;
    setItems([]); setTotal(0); setError(null); void load();
    return () => { generation.current++; busy.current = false; };
  }, [knowledgeId, reloadKey, load]);
  return { items, total, error, loading, load };
}
