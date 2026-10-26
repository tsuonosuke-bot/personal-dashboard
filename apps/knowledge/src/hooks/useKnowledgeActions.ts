import { useState, type Dispatch, type SetStateAction } from "react";
import type { useKnowledgeData } from "./useKnowledgeData";
import type { KnowledgeNavigation } from "./useKnowledgeNavigation";
import type { Knowledge, KnowledgeDraft } from "../types";

type Options = {
  data: ReturnType<typeof useKnowledgeData>; navigation: KnowledgeNavigation;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

/** 編集・アーカイブ・復元の成否とUndoを管理する。 */
export function useKnowledgeActions({ data, navigation, setNotice, setActionError }: Options) {
  const { reload, createKnowledge, updateKnowledge, removeAutoTag } = data;
  const { replaceRoute, setOrganize, setShowSearch, setShowHelp, setSelected, setPage } = navigation;
  const [formTarget, setFormTarget] = useState<Knowledge | null | undefined>(undefined);
  const [undoArchived, setUndoArchived] = useState<Knowledge | null>(null);

  const handleReload = () => {
    setPage(1);
    setNotice(null);
    setUndoArchived(null);
    void reload();
  };

  // 自動タグを外したら、開いている詳細にもすぐ反映する。
  const removeAutoTagFrom = async (item: Knowledge, tag: string) => {
    setActionError(null);
    try {
      await removeAutoTag(item.id, tag);
      setSelected((current) => (current && current.id === item.id
        ? { ...current, auto_tags: current.auto_tags.filter((name) => name !== tag) }
        : current));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自動タグを外せませんでした。");
    }
  };

  const openNew = () => {
    setActionError(null);
    setFormTarget(null);
  };

  const openEdit = (item: Knowledge) => {
    replaceRoute({ kind: "dashboard" });
    setOrganize(null);
    setShowSearch(false);
    setShowHelp(false);
    setSelected(null);
    setActionError(null);
    setFormTarget(item);
  };

  const saveKnowledge = async (draft: KnowledgeDraft) => {
    setActionError(null);
    try {
      if (formTarget) {
        await updateKnowledge(formTarget.id, formTarget.content_version, draft);
        setNotice("ナレッジを更新しました。");
      } else {
        await createKnowledge(draft);
        setNotice("ナレッジを追加しました。");
      }
      setFormTarget(undefined);
      setPage(1);
      setUndoArchived(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存に失敗しました。");
    }
  };

  const archiveKnowledge = async (item: Knowledge) => {
    if (!window.confirm(`「${item.title}」をアーカイブしますか？\n一覧から非表示になります。`)) return;
    setActionError(null);
    try {
      const archived = await updateKnowledge(item.id, item.content_version, { archived: true });
      replaceRoute({ kind: "dashboard" });
      setOrganize(null);
      setShowSearch(false);
      setSelected(null);
      setNotice("ナレッジをアーカイブしました。");
      setUndoArchived(archived);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "アーカイブに失敗しました。");
    }
  };

  const restoreKnowledge = async (item: Knowledge) => {
    setActionError(null);
    try {
      await updateKnowledge(item.id, item.content_version, { archived: false });
      setUndoArchived(null);
      setNotice("ナレッジを復元しました。");
      setPage(1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "復元に失敗しました。");
    }
  };

  return { formTarget, setFormTarget, undoArchived, setUndoArchived, handleReload,
    removeAutoTagFrom, openNew, openEdit, saveKnowledge, archiveKnowledge, restoreKnowledge };
}

export type KnowledgeActions = ReturnType<typeof useKnowledgeActions>;
