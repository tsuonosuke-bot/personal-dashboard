import { useCallback, useEffect, useState } from "react";
import { getKnowledge, getQuizLog } from "../lib/api";
import type { Knowledge, QuizLog } from "../types";

export function useKnowledgeData() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [quizLog, setQuizLog] = useState<QuizLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextKnowledge, nextQuizLog] = await Promise.all([
        getKnowledge(),
        getQuizLog(),
      ]);
      setKnowledge(nextKnowledge);
      setQuizLog(nextQuizLog);
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
