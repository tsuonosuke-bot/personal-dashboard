/** DB の knowledge.mastery 制約で許可されている値。 */
export type Mastery = "未学習" | "学習中" | "習得中" | "定着";

export interface Knowledge {
  id: string;
  title: string;
  explanation: string | null;
  source_note: string | null;
  category: string;
  mastery: Mastery;
  ef: number;
  reps: number;
  interval_days: number;
  times_asked: number;
  times_correct: number;
  learned_on: string;
  last_asked_on: string | null;
  tags: string[];
  accuracy: number | null;
  next_review_on: string | null;
  mastery_streak: number;
  archived: boolean;
  created_at: string;
}

export interface QuizLog {
  id: number;
  knowledge_id: string;
  asked_on: string;
  quality: number;
  verdict: QuizVerdict;
  format: string;
  note: string | null;
  created_at: string;
}

export type QuizVerdict = "正解" | "不正解" | "部分正解";

export type ReviewFilter = "all" | "today" | "overdue" | "due";
export type SortKey = "created_at" | "title" | "category" | "mastery" | "accuracy" | "next_review_on";
export type SortDirection = "asc" | "desc";

export interface Filters {
  search: string;
  category: string;
  mastery: string;
  review: ReviewFilter;
}

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export interface KnowledgeDraft {
  title: string;
  explanation: string | null;
  source_note: string | null;
  category: string;
  mastery: Mastery;
  tags: string[];
  next_review_on: string | null;
}

export type QuizMode = "english" | "non_english" | "all";

export interface QuizQuestion {
  id: string;
  question: string;
}

export interface QuizGradeResult {
  id: string;
  title: string;
  verdict: QuizVerdict;
  quality: number;
  explanation: string;
  next_review_on: string | null;
  recorded: boolean;
}
