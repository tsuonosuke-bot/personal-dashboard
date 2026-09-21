/** DB の knowledge.mastery 制約で許可されている値。 */
export type Mastery = "未学習" | "学習中" | "習得中" | "定着";

/** 同じ期限内での出題順を調整するナレッジの優先度。 */
export type KnowledgePriority = "最高" | "高" | "中" | "低" | "最低";

/** 誤答後の再学習段階。recognition=再認、recall=自由想起。 */
export type RelearningStage = "recognition" | "recall";

export interface Knowledge {
  id: string;
  title: string;
  explanation: string | null;
  source_note: string | null;
  category: string;
  mastery: Mastery;
  priority: KnowledgePriority;
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
  /** 時刻まで含む、実際の次回出題時刻。 */
  next_review_at: string;
  /** 現在保持している定着間隔（時間）。 */
  stability_hours: number;
  relearning_stage: RelearningStage | null;
  last_reviewed_at: string | null;
  mastery_streak: number;
  archived: boolean;
  created_at: string;
  /** 編集競合を検出するための単調増加バージョン。 */
  content_version: number;
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
export type SortKey = "created_at" | "title" | "category" | "mastery" | "priority" | "accuracy" | "next_review_on";
export type SortDirection = "asc" | "desc";

export interface Filters {
  search: string;
  category: string;
  mastery: string;
  priority: string;
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
  priority: KnowledgePriority;
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
  /** 問題文と形式をサーバーへ改ざんされず返すための署名済みトークン。 */
  token: string;
}

export type QuizEmptyReason = "no_knowledge" | "done_today";

export interface QuizStart {
  items: QuizQuestion[];
  /** 出題対象が0件だった理由。1件以上あるときはnull。 */
  reason: QuizEmptyReason | null;
  /** 全問が復習期限前の前倒し出題であることを示す。 */
  early: boolean;
}

export interface DailyReviewStatus {
  review_on: string;
  limit: number;
  total: number;
  completed: number;
  completed_unique: number;
  remaining: number;
  due_total: number;
  overdue_total: number;
  retry_ready: number;
  retry_waiting: number;
  next_retry_at: string | null;
}

export interface RecoveryPreviewDay {
  date: string;
  count: number;
}

export interface RecoveryPreviewItem {
  id: string;
  title: string;
  priority: KnowledgePriority;
  accuracy: number | null;
  overdue_days: number;
  current_next_review_on: string;
  scheduled_on: string;
}

export interface RecoveryPreview {
  total: number;
  daily_limit: number;
  from: string | null;
  through: string | null;
  days: RecoveryPreviewDay[];
  sample: RecoveryPreviewItem[];
  token: string;
}

export interface QuizGradeResult {
  id: string;
  title: string;
  /** 解説画面で出典ナレッジを識別する分類。 */
  category: string;
  /** 採点記録後の最新値。結果画面から安全に優先度を更新するために使う。 */
  priority: KnowledgePriority;
  /** 採点記録後の競合検出用バージョン。 */
  content_version: number;
  verdict: QuizVerdict;
  quality: number;
  correct_answer: string;
  explanation: string;
  next_review_on: string | null;
  next_review_at: string;
  stability_hours: number;
  relearning_stage: RelearningStage | null;
  /** 期限前の正解などで、予定を意図的に据え置いた場合はfalse。 */
  schedule_updated: boolean;
  recorded: boolean;
}

export type QuizGradeFailurePhase = "verification" | "grading" | "recording" | "confirmation";

export interface QuizGradeFailure {
  /** 元の提出配列における問題番号。署名を検証できない場合も画面上の問題へ対応付けられる。 */
  index: number;
  id: string | null;
  phase: QuizGradeFailurePhase;
  error: string;
  /** nullはDB保存の成否を確認できなかったことを示す。 */
  recorded: boolean | null;
}

export interface QuizGradeResponse {
  results: QuizGradeResult[];
  failures: QuizGradeFailure[];
}
