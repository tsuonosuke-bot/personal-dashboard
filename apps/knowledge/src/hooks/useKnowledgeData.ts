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
  const [archivedKnowledge, setArchivedKnowledge] = useState<Knowledge[]>([]);
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
      setKnowledge(nextKnowledge.filter((item) => !item.archived));
      setArchivedKnowledge(nextKnowledge.filter((item) => item.archived));
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
    expectedVersion: number,
    input: Partial<KnowledgeDraft> | { archived: boolean },
  ) => {
    setMutating(true);
    try {
      const updated = await updateKnowledgeApi(id, expectedVersion, input);
      setKnowledge((current) => updated.archived
        ? current.filter((item) => item.id !== id)
        : [updated, ...current.filter((item) => item.id !== id)]);
      setArchivedKnowledge((current) => updated.archived
        ? [updated, ...current.filter((item) => item.id !== id)]
        : current.filter((item) => item.id !== id));
      return updated;
    } finally {
      setMutating(false);
    }
  }, []);

  /** 採点結果を確認済みにした後、全件を読み直さずに手元の記録へ反映する。 */
  const markConfirmed = useCallback((ids: number[], confirmedAt = new Date().toISOString()) => {
    const targets = new Set(ids);
    setQuizLog((current) => current.map((row) => (targets.has(row.id) && row.confirmed_at === null
      ? { ...row, confirmed_at: confirmedAt }
      : row)));
  }, []);

  return {
    knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge, markConfirmed,
  };
}
