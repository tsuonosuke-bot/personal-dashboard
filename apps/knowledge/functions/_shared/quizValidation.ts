/** 復習キューと出題・採点バッチが共有する、問題と回答の上限と形式。 */
export const MAX_QUIZ_LIMIT = 30;
export const MAX_ANSWER_CHARS = 2_000;
export const MAX_QUESTION_CHARS = 2_000;
export const MAX_CHOICE_CHARS = 500;
export const MAX_QUIZ_CATEGORIES = 50;
export const MAX_CATEGORY_CHARS = 100;

/** quiz_log.format のCHECK制約で許可されている値のうち、ダッシュボードから出題できるもの。 */
export const QUIZ_FORMATS = ["一問一答", "四択", "記述説明", "産出"] as const;
export type QuizFormat = (typeof QUIZ_FORMATS)[number];

/** 項目ごとに習熟度から形式を選ばせる指定。生成バッチは常にこれで出題する。 */
export const AUTO_FORMAT = "おまかせ";
export type QuizFormatRequest = QuizFormat | typeof AUTO_FORMAT;
