export interface SpendDifference { diff: number; sign: "＋" | "−" | "±"; trend: "up" | "down" | "flat" }
export function spendDifference(current: unknown, previousToDate: unknown): SpendDifference | null;
export function unclassifiedToShow(value: unknown): number | null;
