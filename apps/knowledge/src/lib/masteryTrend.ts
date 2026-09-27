import type { Mastery, MasteryHistoryEvent } from "../types";
import {
  dayKey, dayLabel, tokyoCivilDay, weekStart, type RegistrationTrendGranularity,
} from "./registrationTrend.ts";

export interface MasteryTrendPoint {
  key: string;
  label: string;
  /** 記録開始前の期間はnull。0件と区別してグラフを途切れさせる。 */
  learning: number | null;
  mastered: number | null;
}

export interface MasteryTrend {
  points: MasteryTrendPoint[];
  trackingSince: string | null;
}

/** 各期間の末日（今日を超えない）時点で、各ナレッジの最新の習熟度を数える。 */
export function buildMasteryTrend(
  events: MasteryHistoryEvent[],
  granularity: RegistrationTrendGranularity,
  now = new Date(),
  periods = granularity === "day" ? 30 : 12,
): MasteryTrend {
  const today = tokyoCivilDay(now);
  if (today === null || !Number.isSafeInteger(periods) || periods < 1) {
    return { points: [], trackingSince: null };
  }
  const dated = events
    .map((event) => ({ event, day: tokyoCivilDay(new Date(event.changed_at)) }))
    .filter((entry): entry is { event: MasteryHistoryEvent; day: number } => entry.day !== null)
    .sort((a, b) => a.day - b.day || a.event.changed_at.localeCompare(b.event.changed_at) || a.event.id - b.event.id);
  const firstDay = dated.length > 0 ? dated[0].day : null;

  const step = granularity === "week" ? 7 : 1;
  const currentStart = granularity === "week" ? weekStart(today) : today;
  const firstStart = currentStart - (periods - 1) * step;
  const latest = new Map<string, Mastery>();
  let cursor = 0;

  const points = Array.from({ length: periods }, (_, index) => {
    const start = firstStart + index * step;
    const end = Math.min(start + step - 1, today);
    while (cursor < dated.length && dated[cursor].day <= end) {
      latest.set(dated[cursor].event.knowledge_id, dated[cursor].event.to_mastery);
      cursor += 1;
    }
    const tracked = firstDay !== null && firstDay <= end;
    let learning = 0;
    let mastered = 0;
    for (const mastery of latest.values()) {
      if (mastery === "習得中") learning += 1;
      if (mastery === "定着") mastered += 1;
    }
    return {
      key: dayKey(start),
      label: dayLabel(start, granularity),
      learning: tracked ? learning : null,
      mastered: tracked ? mastered : null,
    };
  });

  return { points, trackingSince: firstDay === null ? null : dayKey(firstDay) };
}
