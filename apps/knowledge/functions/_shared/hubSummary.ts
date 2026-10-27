import { isDate } from "./learningReads.ts";

export interface DatedHubAnswers {
  date: string | null;
  todayAnswered: number | null;
}

/** A legacy/malformed activity field must not erase a known queue or become a false zero. */
export function datedHubAnswers(value: Record<string, unknown>): DatedHubAnswers {
  const valid = typeof value.date === "string" && isDate(value.date)
    && typeof value.todayAnswered === "number" && Number.isSafeInteger(value.todayAnswered) && value.todayAnswered >= 0;
  return valid ? { date: value.date as string, todayAnswered: value.todayAnswered as number }
    : { date: null, todayAnswered: null };
}
