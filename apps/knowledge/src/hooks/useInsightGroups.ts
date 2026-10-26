import { useCallback, useEffect, useRef, useState } from "react";
import {
  addInsightGroupMember,
  addInsightGroupMembers,
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
  /** 一度の要求で所属を追加する。追加できなかった示唆IDを返す。 */
  addMembers: (groupId: number, insightIds: readonly number[]) => Promise<number[]>;
}

function oldestFirst(groups: InsightGroup[]): InsightGroup[] {
  return [...groups].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

export function useInsightGroups(): InsightGroupStore {
  const [groups, setGroups] = useState<InsightGroup[]>([]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
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
    groupsRef.current = oldestFirst([...groupsRef.current, created]);
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
    const ids = [...new Set(insightIds)];
    if (!ids.length) return [];
    const group = groupsRef.current.find((item) => item.id === groupId);
    if (!group) throw new Error("問いを再読み込みしてから追加してください。");
    const result = await addInsightGroupMembers(groupId, ids, group.updated_at);
    setMembers((current) => [...current.filter((member) => member.group_id !== groupId
      || !result.members.some((added) => added.insight_id === member.insight_id)), ...result.members]);
    // The returned timestamp includes membership triggers, so stale edit/delete still conflicts.
    setGroups((current) => oldestFirst([...current.filter((group) => group.id !== groupId), result.group]));
    groupsRef.current = oldestFirst([...groupsRef.current.filter((group) => group.id !== groupId), result.group]);
    return result.failedIds;
  }, []);

  return { groups, members, loading, error, reload, create, update, remove, addMember, removeMember, addMembers };
}
