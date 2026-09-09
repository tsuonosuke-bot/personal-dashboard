import type { Mastery } from "./types";

export const ALL = "すべて";

export const MASTERY_ORDER: Mastery[] = ["未学習", "学習中", "定着"];

export const MASTERY_COLORS: Record<Mastery, string> = {
  未学習: "#f87171",
  学習中: "#fbbf24",
  定着: "#4ade80",
};

export const PIE_COLORS = [
  "#60a5fa", "#f472b6", "#facc15", "#4ade80", "#a78bfa",
  "#fb923c", "#2dd4bf", "#f87171", "#94a3b8", "#c084fc",
];

export const PAGE_SIZE = 15;
