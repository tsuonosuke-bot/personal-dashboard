import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortKnowledge,
  getJstToday,
  getReviewCounts,
  getWeakCategories,
} from "../src/lib/knowledge.ts";
import type { Filters, Knowledge, SortState } from "../src/types.ts";

function knowledge(id: string, patch: Partial<Knowledge> = {}): Knowledge {
  return {
    id,
    title: `title-${id}`,
    explanation: null,
    source_note: null,
    category: "共通",
    mastery: "未学習",
    priority: "高",
    ef: 2.5,
    reps: 0,
    interval_days: 0,
    times_asked: 0,
    times_correct: 0,
    learned_on: "2026-09-01",
    last_asked_on: null,
    next_review_on: null,
    next_review_at: "2026-09-01T00:00:00Z",
    stability_hours: 0,
    relearning_stage: null,
    last_reviewed_at: null,
    archived: false,
    created_at: "2026-09-01T00:00:00Z",
    accuracy: null,
    tags: [],
    mastery_streak: 0,
    content_version: 1,
    ...patch,
  };
}

const defaultFilters: Filters = {
  search: "",
  category: "すべて",
  mastery: "すべて",
  priority: "すべて",
  review: "all",
};
const defaultSort: SortState = { key: "created_at", direction: "desc" };

test("JST基準の日付を返す", () => {
  assert.equal(getJstToday(new Date("2026-09-08T15:01:00Z")), "2026-09-09");
});

test("今日・期限超過・本日までを正しく絞り込む", () => {
  const rows = [
    knowledge("today", { next_review_on: "2026-09-09", next_review_at: "2026-09-09T03:00:00Z" }),
    knowledge("overdue", { next_review_on: "2026-09-08", next_review_at: "2026-09-08T03:00:00Z" }),
    knowledge("future", { next_review_on: "2026-09-10", next_review_at: "2026-09-10T03:00:00Z" }),
  ];
  assert.deepEqual(
    filterAndSortKnowledge(rows, { ...defaultFilters, review: "today" }, defaultSort, "2026-09-09", new Date("2026-09-09T06:00:00Z")).map((item) => item.id),
    ["today"],
  );
  assert.deepEqual(
    filterAndSortKnowledge(rows, { ...defaultFilters, review: "overdue" }, defaultSort, "2026-09-09", new Date("2026-09-09T06:00:00Z")).map((item) => item.id),
    ["overdue"],
  );
  assert.equal(getReviewCounts(rows, "2026-09-09", new Date("2026-09-09T06:00:00Z")).due, 2);
});

test("タイトル・説明・出典・タグを検索して並び替える", () => {
  const rows = [
    knowledge("b", { title: "Beta", tags: ["Cloudflare"], created_at: "2026-09-02T00:00:00Z" }),
    knowledge("a", { title: "Alpha", source_note: "API設計", created_at: "2026-09-01T00:00:00Z" }),
  ];
  const byTag = filterAndSortKnowledge(rows, { ...defaultFilters, search: "cloudflare" }, defaultSort);
  assert.deepEqual(byTag.map((item) => item.id), ["b"]);
  const sorted = filterAndSortKnowledge(rows, defaultFilters, { key: "title", direction: "asc" });
  assert.deepEqual(sorted.map((item) => item.id), ["a", "b"]);
});

test("優先度で絞り込み、最高・高・中・低・最低の順に並び替える", () => {
  const rows = [
    knowledge("lowest", { priority: "最低" }),
    knowledge("low", { priority: "低" }),
    knowledge("highest", { priority: "最高" }),
    knowledge("high", { priority: "高" }),
    knowledge("medium", { priority: "中" }),
  ];
  const filtered = filterAndSortKnowledge(
    rows,
    { ...defaultFilters, priority: "最高" },
    { key: "priority", direction: "asc" },
  );
  assert.deepEqual(filtered.map((item) => item.id), ["highest"]);
  const sorted = filterAndSortKnowledge(rows, defaultFilters, { key: "priority", direction: "asc" });
  assert.deepEqual(sorted.map((item) => item.id), ["highest", "high", "medium", "low", "lowest"]);
});

test("苦手カテゴリを回答数で加重して算出する", () => {
  const rows = [
    knowledge("1", { category: "A", times_asked: 8, times_correct: 2 }),
    knowledge("2", { category: "A", times_asked: 2, times_correct: 1 }),
    knowledge("3", { category: "B", times_asked: 10, times_correct: 8 }),
  ];
  const weak = getWeakCategories(rows);
  assert.deepEqual(weak.map((item) => item.category), ["A", "B"]);
  assert.equal(weak[0].accuracy, 0.3);
  assert.equal(weak[0].attempts, 10);
});
