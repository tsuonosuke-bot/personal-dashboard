import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeAutoTag,
  createKnowledge as createKnowledgeApi,
  getAutoTags,
  getKnowledge,
  getQuizLog,
  updateKnowledge as updateKnowledgeApi,
} from "../lib/api";
import type { Knowledge, KnowledgeDraft, QuizLog } from "../types";

/** 自動タグ（#93）をナレッジごとにまとめる。一覧APIは近い順に返す。 */
function groupAutoTags(rows: { knowledge_id: string; tag: string }[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const row of rows) byId.set(row.knowledge_id, [...(byId.get(row.knowledge_id) ?? []), row.tag]);
  return byId;
}


export function useKnowledgeData() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [archivedKnowledge, setArchivedKnowledge] = useState<Knowledge[]>([]);
  const [quizLog, setQuizLog] = useState<QuizLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  // 保存の応答には自動タグが無いので、手元の一覧から引き継ぐために最新の一覧を持っておく。
  const listsRef = useRef<Knowledge[]>([]);
  listsRef.current = [...knowledge, ...archivedKnowledge];

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedKnowledge, nextQuizLog, autoTags] = await Promise.all([
        getKnowledge(),
        getQuizLog(),
        // 自動タグが読めなくても一覧は出す（自分で付けたタグだけになる）。
        getAutoTags().catch(() => []),
      ]);
      const autoById = groupAutoTags(autoTags);
      const nextKnowledge = loadedKnowledge.map((item) => ({ ...item, auto_tags: autoById.get(item.id) ?? [] }));
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
      const saved = await updateKnowledgeApi(id, expectedVersion, input);
      const previous = listsRef.current.find((item) => item.id === id);
      const updated = previous ? { ...saved, auto_tags: previous.auto_tags } : saved;
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

  /** 自動タグを外す。外したタグは次の自動処理でも付かない。 */
  const removeAutoTag = useCallback(async (knowledgeId: string, tag: string) => {
    setMutating(true);
    try {
      await changeAutoTag(knowledgeId, tag, "remove");
      const drop = (items: Knowledge[]) => items.map((item) => (item.id === knowledgeId
        ? { ...item, auto_tags: item.auto_tags.filter((name) => name !== tag) }
        : item));
      setKnowledge(drop);
      setArchivedKnowledge(drop);
    } finally {
      setMutating(false);
    }
  }, []);

  /** 外した自動タグを戻す（ノートの「外したもの」から）。 */
  const restoreAutoTag = useCallback(async (knowledgeId: string, tag: string) => {
    setMutating(true);
    try {
      await changeAutoTag(knowledgeId, tag, "restore");
      const add = (items: Knowledge[]) => items.map((item) => (item.id === knowledgeId && !item.auto_tags.includes(tag)
        ? { ...item, auto_tags: [...item.auto_tags, tag] }
        : item));
      setKnowledge(add);
      setArchivedKnowledge(add);
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
    reload, createKnowledge, updateKnowledge, removeAutoTag, restoreAutoTag, markConfirmed,
  };
}
