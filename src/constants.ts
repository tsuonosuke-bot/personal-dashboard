import type { KnowledgePriority, Mastery } from "./types";

export const ALL = "すべて";

export const MASTERY_ORDER: Mastery[] = ["未学習", "学習中", "習得中", "定着"];
export const PRIORITY_ORDER: KnowledgePriority[] = ["最高", "高", "中", "低", "最低"];

export const PRIORITY_INTERVAL_HINTS: Record<KnowledgePriority, string> = {
  最高: "同じ期限の問題の中で最優先",
  高: "同じ期限の問題の中で優先",
  中: "同じ期限の問題の中で標準",
  低: "同じ期限の問題の中で後寄り",
  最低: "同じ期限の問題の中で最後寄り",
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
