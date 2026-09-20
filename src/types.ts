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

/** DB の quiz_log.format 制約のうち、ダッシュボードから出題できる形式。 */
export type QuizFormat = "一問一答" | "四択" | "記述説明" | "産出";

/** 出題時だけ指定できる、項目ごとに習熟度から形式を決めさせる指定。 */
export type QuizFormatRequest = QuizFormat | "おまかせ";

export interface QuizQuestion {
  id: string;
  question: string;
  format: QuizFormat;
  /** 四択のときだけ入る選択肢。他の形式ではnull。 */
  choices: string[] | null;
}

export type QuizEmptyReason = "no_knowledge" | "done_today";

export interface QuizStart {
  items: QuizQuestion[];
  /** 出題対象が0件だった理由。1件以上あるときはnull。 */
  reason: QuizEmptyReason | null;
  /** 全問が復習期限前の前倒し出題であることを示す。 */
  early: boolean;
}

export interface QuizGradeResult {
  id: string;
  title: string;
  verdict: QuizVerdict;
  quality: number;
  correct_answer: string;
  explanation: string;
  next_review_on: string | null;
  recorded: boolean;
}
