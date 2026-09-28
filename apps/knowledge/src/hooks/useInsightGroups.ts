import { useCallback, useEffect, useState } from "react";
import {
  addInsightGroupMember,
  createInsightGroup,
  deleteInsightGroup,
  getInsightGroupMembers,
  getInsightGroups,
  removeInsightGroupMember,
  updateInsightGroup,
} from "../lib/api";
import type { InsightGroup, InsightGroupMember } from "../types";

export interface InsightGroupStore {
  groups: InsightGroup[];
  members: InsightGroupMember[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (title: string, guidingQuestion: string) => Promise<InsightGroup>;
  update: (group: InsightGroup, title: string, guidingQuestion: string) => Promise<InsightGroup>;
  remove: (group: InsightGroup) => Promise<void>;
  addMember: (groupId: number, insightId: number) => Promise<void>;
  removeMember: (groupId: number, insightId: number) => Promise<void>;
  /** 複数の示唆を順に追加し、最後に1回だけ読み直す。追加できなかった示唆IDを返す。 */
  addMembers: (groupId: number, insightIds: readonly number[]) => Promise<number[]>;
}

function oldestFirst(groups: InsightGroup[]): InsightGroup[] {
  return [...groups].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

export function useInsightGroups(): InsightGroupStore {
  const [groups, setGroups] = useState<InsightGroup[]>([]);
  const [members, setMembers] = useState<InsightGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextGroups, nextMembers] = await Promise.all([getInsightGroups(), getInsightGroupMembers()]);
      setGroups(oldestFirst(nextGroups));
      setMembers(nextMembers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "示唆グループを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (title: string, guidingQuestion: string) => {
    const created = await createInsightGroup(title, guidingQuestion);
    setGroups((current) => oldestFirst([...current, created]));
    return created;
  }, []);

  const update = useCallback(async (group: InsightGroup, title: string, guidingQuestion: string) => {
    const updated = await updateInsightGroup(group, title, guidingQuestion);
    setGroups((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);

  const remove = useCallback(async (group: InsightGroup) => {
    await deleteInsightGroup(group);
    setGroups((current) => current.filter((item) => item.id !== group.id));
    setMembers((current) => current.filter((item) => item.group_id !== group.id));
  }, []);

  const addMember = useCallback(async (groupId: number, insightId: number) => {
    const member = await addInsightGroupMember(groupId, insightId);
    setMembers((current) => current.some((item) => item.group_id === groupId && item.insight_id === insightId)
      ? current : [...current, member]);
    await reload(); // The database also advances the group's conflict timestamp.
  }, [reload]);

  const removeMember = useCallback(async (groupId: number, insightId: number) => {
    await removeInsightGroupMember(groupId, insightId);
    setMembers((current) => current.filter((item) => item.group_id !== groupId || item.insight_id !== insightId));
    await reload();
  }, [reload]);

  const addMembers = useCallback(async (groupId: number, insightIds: readonly number[]) => {
    const failed: number[] = [];
    for (const insightId of insightIds) {
      try {
        const member = await addInsightGroupMember(groupId, insightId);
        setMembers((current) => current.some((item) => item.group_id === groupId && item.insight_id === insightId)
          ? current : [...current, member]);
      } catch {
        failed.push(insightId);
      }
    }
    await reload();
    return failed;
  }, [reload]);

  return { groups, members, loading, error, reload, create, update, remove, addMember, removeMember, addMembers };
}
