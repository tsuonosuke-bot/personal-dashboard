import type { Knowledge, SpeakingPracticeLog, SpeakingPracticeRating, SpeakingPracticeType } from "../types";
import type { LearningLogPeriod } from "./learningLog";

export interface SpeakingLogFilters {
  period: LearningLogPeriod;
  type: SpeakingPracticeType | "all";
  rating: SpeakingPracticeRating | "all";
}

export interface SpeakingLogEntry extends SpeakingPracticeLog {
  /** 練習した日（日本時間）。 */
  practiced_on: string;
  title: string;
}

export interface SpeakingDay {
  date: string;
  smooth: number;
  almost: number;
  retry: number;
  total: number;
}

export const SPEAKING_RATING_LABELS: Record<SpeakingPracticeRating, string> = {
  smooth: "言えた",
  almost: "ほぼ言えた",
  retry: "もう一度",
};

export const SPEAKING_TYPE_LABELS: Record<SpeakingPracticeType, string> = {
  instant_composition: "瞬間英作文",
  read_aloud: "音読",
};

const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function jstDate(value: string | Date): string {
  const parts = Object.fromEntries(
    JST_DATE.formatToParts(typeof value === "string" ? new Date(value) : value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 期間の初日（日本時間）。「すべて」は記録の最初の日、記録がなければ今日。 */
export function speakingPeriodStart(period: LearningLogPeriod, today: string, logs: readonly SpeakingPracticeLog[]): string {
  if (period !== "all") return shiftDate(today, -(Number(period) - 1));
  const first = logs.reduce<string | null>((min, log) => {
    const day = jstDate(log.practiced_at);
    return min === null || day < min ? day : min;
  }, null);
  return first ?? today;
}

/** アーカイブや削除で引けないナレッジの練習も、記録としては残す。 */
export function buildSpeakingLog(
  logs: readonly SpeakingPracticeLog[],
  knowledge: readonly Knowledge[],
  filters: SpeakingLogFilters,
  today: string,
): SpeakingLogEntry[] {
  const byId = new Map(knowledge.map((item) => [item.id, item]));
  const from = speakingPeriodStart(filters.period, today, logs);
  return logs
    .map((log) => ({
      ...log,
      practiced_on: jstDate(log.practiced_at),
      title: byId.get(log.knowledge_id)?.title ?? "（削除されたナレッジ）",
    }))
    .filter((entry) => entry.practiced_on >= from)
    .filter((entry) => filters.type === "all" || entry.practice_type === filters.type)
    .filter((entry) => filters.rating === "all" || entry.rating === filters.rating)
    .sort((a, b) => b.practiced_at.localeCompare(a.practiced_at) || b.id - a.id);
}

/** 期間中の毎日を0件の日も含めて並べ、評価別の練習回数を数える。 */
export function speakingDailyCounts(entries: readonly SpeakingLogEntry[], from: string, today: string): SpeakingDay[] {
  const days = new Map<string, SpeakingDay>();
  for (let date = from; date <= today; date = shiftDate(date, 1)) {
    days.set(date, { date, smooth: 0, almost: 0, retry: 0, total: 0 });
  }
  for (const entry of entries) {
    const day = days.get(entry.practiced_on);
    if (!day) continue;
    day[entry.rating] += 1;
    day.total += 1;
  }
  return [...days.values()];
}

export function speakingSummary(entries: readonly SpeakingLogEntry[]) {
  const smooth = entries.filter((entry) => entry.rating === "smooth").length;
  return {
    total: entries.length,
    days: new Set(entries.map((entry) => entry.practiced_on)).size,
    smooth,
    smoothRate: entries.length === 0 ? null : Math.round((smooth / entries.length) * 100),
  };
}
