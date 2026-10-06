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
  /** 以下は問題キュー経由の回答だけが持つ。以前の記録と都度採点の記録ではnull。 */
  question: string | null;
  user_answer: string | null;
  correct_answer: string | null;
  explanation: string | null;
  answered_at: string | null;
  /** nullかつreview_queue_idがある記録が「未確認の採点結果」。 */
  confirmed_at: string | null;
  review_queue_id: number | null;
}

/** 復習キューの件数と、直近の生成・採点バッチの結果。 */
export interface ReviewQueueStatus {
  ready_total: number;
  ready_due: number;
  waiting_grading: number;
  grading_errors: number;
  unconfirmed_results: number;
  queue_limit: number;
  queue_full: boolean;
  last_generate: { at: string | null; status: string | null; added: number | null; note: string | null } | null;
  last_grade: { at: string | null; status: string | null } | null;
  /** 問題を作り直しても条件を満たさず、生成を保留しているカードの数。 */
  generation_held: number;
}

/** 問題を作り直しても条件を満たさず、生成を保留しているカード。 */
export interface ReviewGenerationHold {
  knowledge_id: string;
  title: string;
  category: string;
  /** 連続で作れなかった回数。1回の失敗は、その場の作り直しを含めた2回の生成。 */
  failure_count: number;
  last_reason: string;
  /** 最後に不採用になった問題文。AIが問題文を返さなかったときはnull。 */
  last_question: string | null;
  last_failed_at: string;
  /** この時刻を過ぎると、次の生成バッチでまた作り直す。 */
  retry_after: string;
}

/** キューから出題された1問。正解の選択肢は含まない。 */
export interface ReviewQuestion {
  id: number;
  knowledge_id: string;
  format: QuizFormat;
  question: string;
  choices: string[] | null;
  category: string;
}

/** 回答の受付結果。四択と無回答はその場で記録された結果を持つ。 */
export interface ReviewAnswerResult {
  id: number;
  status: string;
  /** 問題を作ったときの想定解。回答直後の答え合わせに使う。古い問題ではnull。 */
  expected_answer: string | null;
  result: {
    quiz_log_id: number | null;
    quality: number;
    verdict: QuizVerdict;
    correct_answer: string;
    explanation: string;
  } | null;
}

export type PendingReviewStatus = "answered" | "grading" | "error";

/** 採点待ち・採点中・採点エラーの回答。 */
export interface PendingReviewAnswer {
  id: number;
  knowledge_id: string;
  format: string;
  question: string;
  answer_text: string;
  answered_at: string;
  status: PendingReviewStatus;
  last_error: string | null;
}

/** 生成・採点バッチの実行結果。busyは同じ種類のバッチが実行中だったことを表す。 */
export interface ReviewBatchSummary {
  kind: "generate" | "grade";
  status: "succeeded" | "skipped" | "failed" | "busy";
  processed: number;
  succeeded: number;
  failed: number;
  note: string | null;
  followUp?: ReviewBatchSummary;
}

/** 意味検索（#45）で横断する種類。 */
export type SemanticSourceType = "knowledge" | "insight" | "journal";

export interface SemanticSearchResult {
  source_type: SemanticSourceType;
  /** ナレッジのuuid、示唆のid、日記の日付（YYYY-MM-DD）。 */
  source_id: string;
  /** ナレッジと示唆はナレッジの題名、日記は「YYYY-MM-DDの日記」。 */
  title: string;
  /** ナレッジの説明、示唆の本文、日記の要約。 */
  body: string;
  /** ナレッジのカテゴリ、日記のテーマなど。 */
  meta: string | null;
  /** ナレッジと示唆で開くナレッジ。日記はnull。 */
  knowledge_id: string | null;
  entry_date: string | null;
  /** コサイン類似度（1に近いほど近い）。 */
  similarity: number;
}

export interface SemanticIndexStatus {
  model: string;
  /** サーバーにVOYAGE_API_KEYが設定されているか。 */
  configured: boolean;
  items: { source_type: SemanticSourceType; total: number; embedded: number; last_embedded_at: string | null }[];
}

export interface EmbeddingBatchSummary {
  status: "succeeded" | "skipped" | "failed";
  picked: number;
  saved: number;
  tokens: number;
  note: string | null;
}

/** 答え合わせ画面の「関連」欄（#97）。そのナレッジに意味の近いナレッジ・示唆・問い。 */
export interface RelatedItem {
  kind: "knowledge" | "insight" | "question";
  item_id: string;
  title: string;
  body: string;
  knowledge_id: string | null;
  similarity: number;
}

/** 問いにAIが集めた材料（#95）。外したものは excluded に入り、二度と materials には出ない。 */
export interface QuestionMaterials {
  materials: SemanticSearchResult[];
  excluded: { source_type: SemanticSourceType; source_id: string; title: string; body: string; excluded_at: string }[];
  /** 材料を集められなかった理由（キー未設定など）。集められたときはnull。 */
  note: string | null;
}

/** 習熟度の変更履歴。is_baselineは記録開始時点の状態。 */
export interface MasteryHistoryEvent {
  id: number;
  knowledge_id: string;
  to_mastery: Mastery;
  is_baseline: boolean;
  changed_at: string;
}

/** 復習スケジュールとは独立して記録する英会話練習の種別。 */
export type SpeakingPracticeType = "instant_composition" | "read_aloud";

export type SpeakingPracticeMode = "mixed" | SpeakingPracticeType;

/** 英会話練習後の自己評価。 */
export type SpeakingPracticeRating = "smooth" | "almost" | "retry";

/** AIがナレッジを基に生成した、1件分の発話練習カード。 */
export interface SpeakingPracticePrompt {
  knowledge_id: string;
  practice_type: SpeakingPracticeType;
  /** 瞬間英作文では出題文、音読では英語例文の自然な日本語訳。 */
  prompt_ja: string;
  /** 元の表現を実際のビジネス場面で使った短い英語例文。 */
  target_en: string;
}

export interface SpeakingPracticeStart {
  items: SpeakingPracticePrompt[];
}

export interface SpeakingPracticeLog {
  id: number;
  attempt_id: string;
  session_id: string;
  knowledge_id: string;
  practice_type: SpeakingPracticeType;
  rating: SpeakingPracticeRating;
  answer_text: string | null;
  repetitions: number;
  practiced_at: string;
}

export interface SpeakingPracticeWrite {
  attempt_id: string;
  session_id: string;
  knowledge_id: string;
  practice_type: SpeakingPracticeType;
  rating: SpeakingPracticeRating;
  answer_text: string | null;
  repetitions: number;
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


export interface DailyReviewCategoryCount {
  category: string;
  count: number;
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
  remaining_by_category: DailyReviewCategoryCount[];
  /** 1日に日次キューへ入れる未出題カードの上限 */
  new_limit: number;
  /** 期限到来済みだが上限のため明日以降へ回した未出題カード */
  new_held: number;
}


/** ナレッジごとに残す「自分にとってどう役立つか」の付箋。出題・採点には使わない。 */
export interface KnowledgeInsight {
  id: number;
  knowledge_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** 自分で名付けた問い。示唆そのものは既存のknowledge_insightsを参照する。 */
export interface InsightGroup {
  id: number;
  title: string;
  guiding_question: string;
  created_at: string;
  updated_at: string;
}

export interface InsightGroupMember {
  group_id: number;
  insight_id: number;
}

export interface InsightTheme {
  title: string;
  /** 問いとして保存するときの問い文の下書き。空文字のこともある。 */
  guiding_question: string;
  summary: string;
  importance: string;
  insight_ids: number[];
}

export interface InsightAnalysis {
  themes: InsightTheme[];
  analyzed_count: number;
}
