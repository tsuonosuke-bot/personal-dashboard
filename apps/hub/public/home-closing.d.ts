export const CLOSING_HOUR: number;
export function jstHour(now?: Date): number;
export function msUntilClosing(now?: Date): number;
export interface ClosingRow { key: "habits" | "journal-today" | "journal-yesterday" | "unclassified" | "inbox"; label: string; href: string | null }
export function closingView(
  input: {
    summary: Record<string, unknown> | null | undefined;
    journalTrend: unknown;
    today: { completed?: unknown; habitsLeft?: unknown } | null | undefined;
    navigation: { financial?: string; compass?: string } | null | undefined;
  },
  now?: Date,
): { show: boolean; completed: number | null; rows: ClosingRow[]; done: boolean };
