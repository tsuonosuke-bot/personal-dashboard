import type { KnowledgePriority, Mastery } from "./types";

export const ALL = "すべて";

export const MASTERY_ORDER: Mastery[] = ["未学習", "学習中", "習得中", "定着"];
export const PRIORITY_ORDER: KnowledgePriority[] = ["最高", "高", "中", "低", "最低"];

export const PRIORITY_INTERVAL_HINTS: Record<KnowledgePriority, string> = {
  最高: "現在の標準の約1/2の間隔",
  高: "現在の標準間隔",
  中: "現在の標準の約1.5倍の間隔",
  低: "現在の標準の約2倍の間隔",
  最低: "現在の標準の約3倍の間隔",
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
