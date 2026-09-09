import { useCallback, useEffect, useState } from "react";
import { configError, supabase } from "../lib/supabase";
import type { Knowledge, QuizLog } from "../types";

export function useKnowledgeData() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [quizLog, setQuizLog] = useState<QuizLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (configError) {
      setError(configError);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [k, q] = await Promise.all([
        supabase
          .from("knowledge")
          .select("*")
          .eq("archived", false)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("quiz_log")
          .select("*")
          .order("asked_on", { ascending: true })
          .limit(5000),
      ]);
      if (k.error) throw new Error(`knowledge: ${k.error.message}`);
      if (q.error) throw new Error(`quiz_log: ${q.error.message}`);
      setKnowledge((k.data ?? []) as Knowledge[]);
      setQuizLog((q.data ?? []) as QuizLog[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { knowledge, quizLog, loading, error, reload };
}
