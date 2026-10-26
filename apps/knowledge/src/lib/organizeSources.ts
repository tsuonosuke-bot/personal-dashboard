import type { OrganizeTab } from "./dashboardRoute";
import type { InsightGroupMember, KnowledgeInsight } from "../types";

export type OrganizeSourceState = { loading: boolean; error: string | null };

/** 取得失敗を削除済みと混同せず、同じ参照IDで再試行できる状態にする。 */
export async function loadOrganizeSources(
  ids: readonly string[],
  load: (ids: readonly string[]) => Promise<void>,
  onState: (state: OrganizeSourceState) => void,
): Promise<void> {
  onState({ loading: ids.length > 0, error: null });
  if (!ids.length) return;
  try {
    await load(ids);
    onState({ loading: false, error: null });
  } catch (caught) {
    onState({ loading: false, error: caught instanceof Error ? caught.message : "出典を取得できませんでした。" });
  }
}

/** 開いた整理タブの出典だけを読む。ノートは選択した問いの手動所属に限定する。 */
export function organizeSourceIds(
  organize: { tab: OrganizeTab; questionId: number | null } | null,
  insights: readonly KnowledgeInsight[],
  members: readonly InsightGroupMember[],
): string[] {
  if (!organize) return [];
  if (organize.tab === "questions" || organize.tab === "insights") {
    return [...new Set(insights.map((item) => item.knowledge_id))];
  }
  if (organize.tab !== "notes" || organize.questionId === null) return [];
  const selected = new Set(members.filter((member) => member.group_id === organize.questionId).map((member) => member.insight_id));
  return [...new Set(insights.filter((item) => selected.has(item.id)).map((item) => item.knowledge_id))];
}
