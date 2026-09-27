import assert from "node:assert/strict";
import test from "node:test";
import {
  selectSpeakingPracticeKnowledge,
  speakingPracticeCandidates,
  speakingPracticeStats,
} from "../src/lib/speakingPractice.ts";
import type { Knowledge, SpeakingPracticeLog } from "../src/types.ts";

function knowledge(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "Would you mind doing",
    explanation: "相手に丁寧に依頼するときの表現。Would you mind doing the review? のように使う。",
    source_note: null,
    category: "英語",
    mastery: "学習中",
    priority: "中",
    ef: 2.5,
    reps: 1,
    interval_days: 1,
    times_asked: 1,
    times_correct: 1,
    learned_on: "2026-09-20",
    last_asked_on: null,
    tags: ["英語", "フレーズ"],
    accuracy: 100,
    next_review_on: "2026-09-22",
    next_review_at: "2026-09-22T00:00:00Z",
    stability_hours: 24,
    relearning_stage: null,
    last_reviewed_at: null,
    mastery_streak: 1,
    archived: false,
    created_at: "2026-09-20T00:00:00Z",
    content_version: 1,
    ...overrides,
  };
}

test("英語カテゴリまたは英語系タグのアクティブ項目だけを練習候補にする", () => {
  const tagged = knowledge({ id: "223e4567-e89b-42d3-a456-426614174000", category: "仕事", tags: ["英会話"] });
  const archived = knowledge({ id: "323e4567-e89b-42d3-a456-426614174000", archived: true });
  const japaneseOnly = knowledge({ id: "423e4567-e89b-42d3-a456-426614174000", title: "丁寧な依頼" });
  assert.deepEqual(
    speakingPracticeCandidates([knowledge(), tagged, archived, japaneseOnly]).map((item) => item.id),
    [knowledge().id, tagged.id],
  );
});

test("AI生成に渡すナレッジは候補から重複なしで選ぶ", () => {
  const items = [
    knowledge(),
    knowledge({ id: "223e4567-e89b-42d3-a456-426614174000", title: "walk someone through" }),
    knowledge({ id: "323e4567-e89b-42d3-a456-426614174000", title: "at your earliest convenience" }),
  ];
  const selected = selectSpeakingPracticeKnowledge(items, 10, () => 0.99);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((item) => item.id)).size, 3);
  assert.deepEqual(new Set(selected.map((item) => item.id)), new Set(items.map((item) => item.id)));
});

test("練習集計はJSTの日付で今日の記録を数える", () => {
  const base: SpeakingPracticeLog = {
    id: 1,
    attempt_id: "123e4567-e89b-42d3-a456-426614174001",
    session_id: "123e4567-e89b-42d3-a456-426614174002",
    knowledge_id: knowledge().id,
    practice_type: "instant_composition",
    rating: "smooth",
    answer_text: null,
    repetitions: 1,
    practiced_at: "2026-09-20T15:30:00.000Z",
  };
  const stats = speakingPracticeStats([
    base,
    { ...base, id: 2, attempt_id: "123e4567-e89b-42d3-a456-426614174003", rating: "retry", practiced_at: "2026-09-20T14:30:00.000Z" },
  ], new Date("2026-09-21T01:00:00.000Z"));
  assert.deepEqual(stats, { today: 1, recent: 2, smooth: 1 });
});
