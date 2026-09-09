import { useCallback, useEffect, useState } from "react";
import {
  createKnowledge as createKnowledgeApi,
  getKnowledge,
  getQuizLog,
  updateKnowledge as updateKnowledgeApi,
} from "../lib/api";
import type { Knowledge, KnowledgeDraft, QuizLog } from "../types";

export function useKnowledgeData() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [quizLog, setQuizLog] = useState<QuizLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

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

  const createKnowledge = useCallback(async (input: KnowledgeDraft) => {
    setMutating(true);
    try {
      const created = await createKnowledgeApi(input);
      setKnowledge((current) => [created, ...current]);
      return created;
    } finally {
      setMutating(false);
    }
  }, []);

  const updateKnowledge = useCallback(async (
    id: string,
    input: Partial<KnowledgeDraft> | { archived: boolean },
  ) => {
    setMutating(true);
    try {
      const updated = await updateKnowledgeApi(id, input);
      setKnowledge((current) => updated.archived
        ? current.filter((item) => item.id !== id)
        : current.map((item) => item.id === id ? updated : item));
      return updated;
    } finally {
      setMutating(false);
    }
  }, []);

  return {
    knowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge,
  };
}
