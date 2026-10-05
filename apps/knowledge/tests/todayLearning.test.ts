import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  categoryBreakdown,
  memoryHold,
  missesToReview,
  mondayOf,
  todayAnswers,
  weeklyReviewAccuracy,
} from "../src/lib/learningSummary.ts";
import type { Knowledge, QuizLog } from "../src/types.ts";

// 2026-10-05（月）15:00 JST
const NOW = new Date("2026-10-05T06:00:00Z");

function log(id: number, knowledgeId: string, askedOn: string, verdict: QuizLog["verdict"], patch: Partial<QuizLog> = {}): QuizLog {
  return {
    id,
    knowledge_id: knowledgeId,
    asked_on: askedOn,
    quality: verdict === "正解" ? 4 : 1,
    verdict,
    format: "一問一答",
    note: null,
    created_at: `${askedOn}T03:00:00Z`,
    question: null,
    user_answer: null,
    correct_answer: null,
    explanation: null,
    answered_at: null,
    confirmed_at: null,
    review_queue_id: null,
    ...patch,
  };
}

function card(id: string, stabilityHours: number): Knowledge {
  return {
    id, title: id, explanation: null, source_note: null, category: "共通", mastery: "学習中", priority: "高",
    ef: 2.5, reps: 0, interval_days: 0, times_asked: 0, times_correct: 0, learned_on: "2026-09-01",
    last_asked_on: null, tags: [], accuracy: null, next_review_on: null, next_review_at: "2026-10-05T00:00:00Z",
    stability_hours: stabilityHours, relearning_stage: null, last_reviewed_at: null, mastery_streak: 0,
    archived: false, created_at: "2026-09-01T00:00:00Z", content_version: 1,
  };
}

test("今日の回答は日本時間の今日の分だけを数え、正答率は正解だけを分子にする", () => {
  const rows = [
    log(1, "a", "2026-10-05", "正解"),
    log(2, "a", "2026-10-05", "部分正解"),
    log(3, "b", "2026-10-05", "不正解"),
    log(4, "c", "2026-10-04", "正解"),
  ];
  assert.deepEqual(todayAnswers(rows, NOW), { answered: 3, correct: 1, cards: 2, accuracy: 1 / 3 });
  assert.equal(todayAnswers([], NOW).accuracy, null);
});

test("見直す講評はキュー経由の未確認の不正解・部分正解だけを新しい順に返す", () => {
  const rows = [
    log(1, "a", "2026-10-05", "不正解", { review_queue_id: 1, answered_at: "2026-10-05T01:00:00Z" }),
    log(2, "a", "2026-10-05", "正解", { review_queue_id: 2, answered_at: "2026-10-05T02:00:00Z" }),
    log(3, "b", "2026-10-05", "部分正解", { review_queue_id: 3, answered_at: "2026-10-05T03:00:00Z" }),
    log(4, "c", "2026-10-05", "不正解", { review_queue_id: 4, confirmed_at: "2026-10-05T04:00:00Z" }),
    log(5, "d", "2026-10-05", "不正解"),
  ];
  assert.deepEqual(missesToReview(rows).map((row) => row.id), [3, 1]);
});

test("記憶のもちは期間ごとに数え、未出題のカードは別枠にする", () => {
  const knowledge = [card("a", 10), card("b", 30), card("c", 100), card("d", 200), card("e", 800), card("f", 0)];
  const quizLog = ["a", "b", "c", "d", "e"].map((id, index) => log(index + 1, id, "2026-10-01", "正解"));
  const result = memoryHold(knowledge, quizLog);
  assert.deepEqual(result.buckets.map((bucket) => [bucket.label, bucket.count]), [
    ["30日以上", 1], ["7〜30日", 1], ["3〜7日", 1], ["1〜3日", 1], ["1日未満", 1],
  ]);
  assert.equal(result.unasked, 1);
  assert.equal(result.atLeastWeek, 2);
  assert.equal(result.total, 6);
});

test("週別の正答率は各カードの初回を除き、今週を集計途中として示す", () => {
  assert.equal(mondayOf("2026-10-05"), "2026-10-05");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  const rows = [
    log(1, "a", "2026-09-29", "不正解"), // 初回は数えない
    log(2, "a", "2026-09-30", "正解"),
    log(3, "a", "2026-10-01", "不正解"),
    log(4, "b", "2026-10-05", "正解"), // 初回
    log(5, "a", "2026-10-05", "正解"),
  ];
  const weeks = weeklyReviewAccuracy(rows, NOW, 2);
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.answered, week.correct, week.partial]), [
    ["2026-09-28", 2, 1, false],
    ["2026-10-05", 1, 1, true],
  ]);
});

test("カテゴリ内訳は0件を除き、多い順に上位だけ出して残りをまとめる", () => {
  const items = [
    { category: "歴史", count: 6 }, { category: "ビジネス", count: 28 }, { category: "地理", count: 0 },
    { category: "英語", count: 5 }, { category: "経済", count: 4 }, { category: "哲学", count: 1 }, { category: "生物", count: 1 },
  ];
  assert.deepEqual(categoryBreakdown(items, 3), [
    { label: "ビジネス", count: 28 }, { label: "歴史", count: 6 }, { label: "英語", count: 5 }, { label: "ほか", count: 6 },
  ]);
});

test("正解の採点結果は記録時に確認済みになり、既存の正解もまとめて確認済みにする", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261005120000_auto_confirm_correct_results.sql", import.meta.url), "utf8");
  assert.match(sql, /new\.review_queue_id is not null and new\.verdict = '正解' and new\.confirmed_at is null/);
  assert.match(sql, /before insert or update of verdict, confirmed_at on public\.quiz_log/);
  assert.match(sql, /update public\.quiz_log\s+set confirmed_at = coalesce\(answered_at, created_at\)\s+where review_queue_id is not null\s+and verdict = '正解'\s+and confirmed_at is null/);
});

test("ダッシュボードは今日の学習・講評の見直し・進み具合のグラフを出し、古い数字カードを出さない", async () => {
  const [app, charts, sheet, review] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DashboardCharts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/MissedReviewSheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /<TodayLearningPanel/);
  assert.match(app, /<MissedReviewSheet/);
  assert.match(app, /confirmReviewResults\(\[quizLogId\]\)/);
  assert.match(app, /markConfirmed\(\[quizLogId\]\)/);
  assert.doesNotMatch(app, /StatsCards|ReviewInsights|DailyReviewPanel/);
  assert.match(charts, /<MemoryHoldChart/);
  assert.match(charts, /<WeeklyAccuracyChart/);
  assert.match(charts, /<details className="other-charts"/);
  assert.match(charts, /othersOpen && \(/);
  assert.match(sheet, /確認した（次へ）/);
  assert.match(sheet, /あなたの回答/);
  assert.match(review, /外した問題の講評を見る（\{missCount\}件）/);
});
