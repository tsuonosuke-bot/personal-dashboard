import type { Knowledge, QuizLog, QuizVerdict } from "../types";

export type LearningLogPeriod = "7" | "30" | "90" | "all";

export interface LearningLogFilters {
  period: LearningLogPeriod;
  category: string;
  verdict: QuizVerdict | "all";
}

export interface LearningLogEntry extends QuizLog {
  title: string;
  category: string;
}

export const ALL_CATEGORIES = "all";

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 削除済みナレッジの回答も履歴としては残すため、タイトルが引けなくても除外しない。 */
export function buildLearningLog(
  logs: QuizLog[],
  knowledge: Knowledge[],
  filters: LearningLogFilters,
  today: string,
): LearningLogEntry[] {
  const byId = new Map(knowledge.map((item) => [item.id, item]));
  const from = filters.period === "all" ? null : shiftDate(today, -(Number(filters.period) - 1));
  return logs
    .map((log) => {
      const item = byId.get(log.knowledge_id);
      return { ...log, title: item?.title ?? "（削除されたナレッジ）", category: item?.category ?? "不明" };
    })
    .filter((entry) => from === null || entry.asked_on >= from)
    .filter((entry) => filters.category === ALL_CATEGORIES || entry.category === filters.category)
    .filter((entry) => filters.verdict === "all" || entry.verdict === filters.verdict)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}
