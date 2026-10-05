import type { DailyReviewCategoryCount, Knowledge, QuizLog } from "../types";

const DAY_MS = 86_400_000;

/** 日本時間の日付（YYYY-MM-DD）。 */
export function tokyoDate(value: Date | string): string {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** その日を含む週の月曜日（日本時間）。 */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export interface TodayAnswers {
  answered: number;
  correct: number;
  cards: number;
  /** 正解だけを分子にした割合（部分正解は含めない）。回答がなければnull。 */
  accuracy: number | null;
}

/** 今日（日本時間）の回答数と正答率。 */
export function todayAnswers(quizLog: QuizLog[], now = new Date()): TodayAnswers {
  const today = tokyoDate(now);
  const rows = quizLog.filter((row) => row.asked_on === today);
  const correct = rows.filter((row) => row.verdict === "正解").length;
  return {
    answered: rows.length,
    correct,
    cards: new Set(rows.map((row) => row.knowledge_id)).size,
    accuracy: rows.length ? correct / rows.length : null,
  };
}

/**
 * 見直す講評: 問題キュー経由で採点され、まだ確認していない不正解・部分正解。
 * 正解はDBのトリガーが記録時に確認済みにするが、古いデータでも数えないよう判定にも入れる。新しい順。
 */
export function missesToReview(quizLog: QuizLog[]): QuizLog[] {
  return quizLog
    .filter((row) => row.review_queue_id !== null && row.confirmed_at === null && row.verdict !== "正解")
    .sort((left, right) => (right.answered_at ?? right.created_at).localeCompare(left.answered_at ?? left.created_at)
      || right.id - left.id);
}

export interface MemoryHoldBucket {
  key: string;
  label: string;
  count: number;
}

const HOLD_BUCKETS: Array<{ key: string; label: string; maxHours: number }> = [
  { key: "30d", label: "30日以上", maxHours: Number.POSITIVE_INFINITY },
  { key: "7d", label: "7〜30日", maxHours: 720 },
  { key: "3d", label: "3〜7日", maxHours: 168 },
  { key: "1d", label: "1〜3日", maxHours: 72 },
  { key: "0d", label: "1日未満", maxHours: 24 },
];

/**
 * 記憶のもち: 次に忘れるまでの見込み期間（stability_hours）ごとのカード数。長い順。
 * 一度も出題していないカードは期間を持たないので、別枠（unasked）で数える。
 */
export function memoryHold(knowledge: Knowledge[], quizLog: QuizLog[]): { buckets: MemoryHoldBucket[]; unasked: number; total: number; atLeastWeek: number } {
  const asked = new Set(quizLog.map((row) => row.knowledge_id));
  const counts = new Map(HOLD_BUCKETS.map((bucket) => [bucket.key, 0]));
  let unasked = 0;
  for (const item of knowledge) {
    if (!asked.has(item.id)) {
      unasked += 1;
      continue;
    }
    const hours = Number.isFinite(item.stability_hours) ? item.stability_hours : 0;
    const bucket = [...HOLD_BUCKETS].reverse().find((candidate) => hours < candidate.maxHours) ?? HOLD_BUCKETS[0];
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }
  const buckets = HOLD_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, count: counts.get(bucket.key) ?? 0 }));
  return {
    buckets,
    unasked,
    total: knowledge.length,
    atLeastWeek: buckets.filter((bucket) => bucket.key === "30d" || bucket.key === "7d").reduce((sum, bucket) => sum + bucket.count, 0),
  };
}

export interface WeeklyAccuracy {
  weekStart: string;
  answered: number;
  correct: number;
  accuracy: number | null;
  /** 今週（集計途中）。 */
  partial: boolean;
}

/**
 * 復習の正答率（週別）: 2回目以降の出題だけを数える。新しく覚える分（そのカードの初回）は含めない。
 * 直近 weeks 週を古い順に返す。
 */
export function weeklyReviewAccuracy(quizLog: QuizLog[], now = new Date(), weeks = 5): WeeklyAccuracy[] {
  const thisWeek = mondayOf(tokyoDate(now));
  const starts = Array.from({ length: weeks }, (_, index) => addDays(thisWeek, (index - weeks + 1) * 7));
  const firstSeen = new Map<string, { date: string; id: number }>();
  for (const row of quizLog) {
    const current = firstSeen.get(row.knowledge_id);
    if (!current || row.asked_on < current.date || (row.asked_on === current.date && row.id < current.id)) {
      firstSeen.set(row.knowledge_id, { date: row.asked_on, id: row.id });
    }
  }
  const totals = new Map(starts.map((start) => [start, { answered: 0, correct: 0 }]));
  for (const row of quizLog) {
    if (firstSeen.get(row.knowledge_id)?.id === row.id) continue;
    const bucket = totals.get(mondayOf(row.asked_on));
    if (!bucket) continue;
    bucket.answered += 1;
    if (row.verdict === "正解") bucket.correct += 1;
  }
  return starts.map((start) => {
    const { answered, correct } = totals.get(start)!;
    return { weekStart: start, answered, correct, accuracy: answered ? correct / answered : null, partial: start === thisWeek };
  });
}

/** 今すぐ解ける分のカテゴリ内訳。0件を除き、多い順に limit 件まで、残りは「ほか」にまとめる。 */
export function categoryBreakdown(items: DailyReviewCategoryCount[], limit = 5): Array<{ label: string; count: number }> {
  const nonZero = items.filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
  const shown = nonZero.slice(0, limit).map((item) => ({ label: item.category, count: item.count }));
  const rest = nonZero.slice(limit).reduce((sum, item) => sum + item.count, 0);
  return rest > 0 ? [...shown, { label: "ほか", count: rest }] : shown;
}
