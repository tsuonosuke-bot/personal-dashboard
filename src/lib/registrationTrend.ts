import type { Knowledge } from "../types";

export type RegistrationTrendGranularity = "day" | "week";

export interface RegistrationTrendPoint {
  key: string;
  label: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const TOKYO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function tokyoCivilDay(value: Date): number | null {
  if (!Number.isFinite(value.getTime())) return null;
  const parts = Object.fromEntries(
    TOKYO_DATE.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  if (!parts.year || !parts.month || !parts.day) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function dayParts(civilDay: number): { year: number; month: number; day: number } {
  const date = new Date(civilDay * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function dayKey(civilDay: number): string {
  const { year, month, day } = dayParts(civilDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dayLabel(civilDay: number, granularity: RegistrationTrendGranularity): string {
  const { month, day } = dayParts(civilDay);
  return granularity === "week" ? `${month}/${day}週` : `${month}/${day}`;
}

export function weekStart(civilDay: number): number {
  const dayOfWeek = new Date(civilDay * DAY_MS).getUTCDay();
  return civilDay - ((dayOfWeek + 6) % 7);
}

/**
 * Knowledgeの登録時刻をJSTの暦日へ変換し、0件の期間も含む連続系列を返す。
 * 呼び出し側がactiveとarchivedの両方を渡すことで、アーカイブ後も登録実績を保持する。
 */
export function buildRegistrationTrend(
  knowledge: Pick<Knowledge, "created_at">[],
  granularity: RegistrationTrendGranularity,
  now = new Date(),
  periods = granularity === "day" ? 30 : 12,
): RegistrationTrendPoint[] {
  if (!Number.isSafeInteger(periods) || periods < 1) return [];
  const today = tokyoCivilDay(now);
  if (today === null) return [];

  const currentStart = granularity === "week" ? weekStart(today) : today;
  const step = granularity === "week" ? 7 : 1;
  const firstStart = currentStart - (periods - 1) * step;
  const counts = new Map<number, number>();

  for (const item of knowledge) {
    const createdDay = tokyoCivilDay(new Date(item.created_at));
    if (createdDay === null || createdDay < firstStart || createdDay > today) continue;
    const bucket = granularity === "week" ? weekStart(createdDay) : createdDay;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return Array.from({ length: periods }, (_, index) => {
    const bucket = firstStart + index * step;
    return {
      key: dayKey(bucket),
      label: dayLabel(bucket, granularity),
      count: counts.get(bucket) ?? 0,
    };
  });
}
