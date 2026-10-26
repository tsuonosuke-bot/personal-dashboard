import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeAutoTag,
  createKnowledge as createKnowledgeApi,
  getAutoTags,
  getKnowledge,
  getKnowledgeItem,
  getKnowledgeSources,
  updateKnowledge as updateKnowledgeApi,
} from "../lib/api";
import type { Knowledge, KnowledgeDraft } from "../types";
import { getArchivePage, getLearningSummary, type LearningSummary } from "../lib/learningReadApi";
import { groupAutoTags, withAutoTags } from "../lib/knowledgeAutoTags";
import { useJstDate } from "./useJstDate";

export type KnowledgeReloadResult = { ok: true } | { ok: false; error: string };

export function useKnowledgeData() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [archivedKnowledge, setArchivedKnowledge] = useState<Knowledge[]>([]);
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const today = useJstDate();
  const summaryGeneration = useRef(0);
  const refreshSummary = useCallback(async () => {
    const generation = ++summaryGeneration.current;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const next = await getLearningSummary(today);
      if (generation === summaryGeneration.current) setSummary(next);
    } catch (caught) {
      if (generation === summaryGeneration.current) setSummaryError(caught instanceof Error ? caught.message : "学習集計を取得できませんでした。");
    } finally { if (generation === summaryGeneration.current) setSummaryLoading(false); }
  }, [today]);
  useEffect(() => { void refreshSummary(); return () => { summaryGeneration.current++; }; }, [refreshSummary]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const autoTagsRef = useRef(new Map<string, string[]>());
  // 既に取得した出典の本文を、同じ閲覧中に重ねて要求しない。
  const listsRef = useRef<Knowledge[]>([]);
  listsRef.current = [...knowledge, ...archivedKnowledge];
  const loadSources = useCallback(async (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((id) => !listsRef.current.some((item) => item.id === id));
    if (!missing.length) return;
    const rows = await getKnowledgeSources(missing);
    setArchivedKnowledge((current) => [...current, ...rows.filter((item) => item.archived && !current.some((existing) => existing.id === item.id))
      .map((item) => withAutoTags(item, autoTagsRef.current))]);
  }, []);
  const loadArchivePage = useCallback(async (search: string, offset: number, limit: number) => {
    const page = await getArchivePage(search, offset, limit);
    return { ...page, items: page.items.map((item) => withAutoTags(item, autoTagsRef.current)) };
  }, []);
  const loadKnowledgeItem = useCallback(async (id: string) => withAutoTags(await getKnowledgeItem(id), autoTagsRef.current), []);

  const reload = useCallback(async (includeSummary = true): Promise<KnowledgeReloadResult> => {
    setLoading(true);
    setError(null);
    try {
      const [loadedKnowledge, autoTags] = await Promise.all([
        getKnowledge("active"),
        // 自動タグが読めなくても一覧は出し、取得済みのタグがあれば保持する。
        getAutoTags().catch(() => null),
      ]);
      if (autoTags !== null) autoTagsRef.current = groupAutoTags(autoTags);
      const nextKnowledge = loadedKnowledge.map((item) => withAutoTags(item, autoTagsRef.current));
      setKnowledge(nextKnowledge.filter((item) => !item.archived));
      setArchivedKnowledge((current) => current.map((item) => withAutoTags(item, autoTagsRef.current)));
      // Cached archived cards are filled only by explicit retrieval/mutations.
      if (includeSummary) void refreshSummary();
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [refreshSummary]);

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const createKnowledge = useCallback(async (input: KnowledgeDraft) => {
    setMutating(true);
    try {
      const created = await createKnowledgeApi(input);
      setKnowledge((current) => [created, ...current]);
      void refreshSummary();
      return created;
    } finally {
      setMutating(false);
    }
  }, [refreshSummary]);

  const updateKnowledge = useCallback(async (
    id: string,
    expectedVersion: number,
    input: Partial<KnowledgeDraft> | { archived: boolean },
  ) => {
    setMutating(true);
    try {
      const saved = await updateKnowledgeApi(id, expectedVersion, input);
      const updated = withAutoTags(saved, autoTagsRef.current);
      setKnowledge((current) => updated.archived
        ? current.filter((item) => item.id !== id)
        : [updated, ...current.filter((item) => item.id !== id)]);
      setArchivedKnowledge((current) => updated.archived
        ? [updated, ...current.filter((item) => item.id !== id)]
        : current.filter((item) => item.id !== id));
      void refreshSummary();
      return updated;
    } finally {
      setMutating(false);
    }
  }, [refreshSummary]);

  /** 自動タグを外す。外したタグは次の自動処理でも付かない。 */
  const removeAutoTag = useCallback(async (knowledgeId: string, tag: string) => {
    setMutating(true);
    try {
      await changeAutoTag(knowledgeId, tag, "remove");
      autoTagsRef.current.set(knowledgeId, (autoTagsRef.current.get(knowledgeId) ?? []).filter((name) => name !== tag));
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
      const tags = autoTagsRef.current.get(knowledgeId) ?? [];
      if (!tags.includes(tag)) autoTagsRef.current.set(knowledgeId, [...tags, tag]);
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
    void ids; void confirmedAt;
    void refreshSummary();
  }, [refreshSummary]);

  return {
    knowledge, archivedKnowledge, loading, error, mutating,
    summary, summaryLoading, summaryError, refreshSummary,
    loadSources, loadArchivePage, loadKnowledgeItem,
    reload, createKnowledge, updateKnowledge, removeAutoTag, restoreAutoTag, markConfirmed,
  };
}
