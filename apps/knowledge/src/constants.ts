import type { KnowledgePriority, Mastery } from "./types";

export const ALL = "すべて";

export const MASTERY_ORDER: Mastery[] = ["未学習", "学習中", "習得中", "定着"];
export const PRIORITY_ORDER: KnowledgePriority[] = ["最高", "高", "中", "低", "最低"];

export const PRIORITY_INTERVAL_HINTS: Record<KnowledgePriority, string> = {
  最高: "復習間隔0.5倍、同じ期限の中で最優先に出題",
  高: "復習間隔1倍、同じ期限の中で優先して出題",
  中: "復習間隔1.5倍、同じ期限の中で標準の順に出題",
  低: "復習間隔2倍、同じ期限の中で後寄りに出題",
  最低: "復習間隔3倍、同じ期限の中で最後寄りに出題",
};

export const MASTERY_COLORS: Record<Mastery, string> = {
  未学習: "#f87171",
  学習中: "#fbbf24",
  習得中: "#818cf8",
  定着: "#4ade80",
};

export const PIE_COLORS = [
  "#60a5fa", "#f472b6", "#facc15", "#4ade80", "#a78bfa",
  "#fb923c", "#2dd4bf", "#f87171", "#94a3b8", "#c084fc",
];

export const DEFAULT_PAGE_SIZE = 15;
export const PAGE_SIZES = [15, 30, 60] as const;
