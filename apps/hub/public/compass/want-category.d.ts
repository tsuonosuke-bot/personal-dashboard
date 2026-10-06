export interface WantCategory {
  key: string;
  label: string;
  description: string;
  tags: string[];
}

export interface BacklogWant {
  id?: number | null;
  type?: string | null;
  note?: string | null;
  revisitOn?: string | null;
  createdAt?: string | null;
}

export const WANT_CATEGORIES: WantCategory[];
export function wantCategoryMeta(key: string): WantCategory;
export function wantCategory(want: BacklogWant): string;
export function wantBacklogStage(want: BacklogWant, today: string): "ready" | "due" | "sleeping";
export function groupWantsByCategory<T extends BacklogWant>(wants: T[], today: string): { key: string; label: string; description: string; items: T[] }[];
