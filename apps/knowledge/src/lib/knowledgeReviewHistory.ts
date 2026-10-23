import type { MasteryHistoryEvent, QuizLog } from "../types";

/** 回答時刻がない古い記録は、記録時刻を並び順にだけ使う。表示には出題日を残す。 */
export function knowledgeAnswers(logs: QuizLog[], knowledgeId: string): QuizLog[] {
  return logs.filter((entry) => entry.knowledge_id === knowledgeId)
    .sort((a, b) => Date.parse(b.answered_at ?? b.created_at) - Date.parse(a.answered_at ?? a.created_at) || b.id - a.id);
}

/** 手動変更も含むため、回答に結び付けず独立した履歴として表示する。 */
export function knowledgeMasteryChanges(events: MasteryHistoryEvent[], knowledgeId: string) {
  const chronological = events.filter((entry) => entry.knowledge_id === knowledgeId)
    .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id - b.id);
  return chronological.map((entry, index) => ({
    ...entry,
    from_mastery: entry.is_baseline ? null : chronological[index - 1]?.to_mastery ?? null,
  })).reverse();
}
