import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpeakingPracticeSession,
  instantCompositionPrompt,
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

test("瞬間英作文のヒントは日本語を使い、登録表現そのものを隠す", () => {
  const prompt = instantCompositionPrompt(knowledge());
  assert.match(prompt, /相手に丁寧に依頼/);
  assert.doesNotMatch(prompt, /Would you mind doing/i);
  const alternatives = instantCompositionPrompt(knowledge({
    title: "first half / last half",
    explanation: "前半は first half、後半は last half と表現する。",
  }));
  assert.doesNotMatch(alternatives, /first half|last half/i);
});

test("ミックス練習は形式を交互にし、候補数を超えて重複させない", () => {
  const items = [
    knowledge(),
    knowledge({ id: "223e4567-e89b-42d3-a456-426614174000", title: "walk someone through" }),
    knowledge({ id: "323e4567-e89b-42d3-a456-426614174000", title: "at your earliest convenience" }),
  ];
  const session = buildSpeakingPracticeSession(items, "mixed", 10, () => 0.99);
  assert.equal(session.length, 3);
  assert.deepEqual(session.map((item) => item.type), ["instant_composition", "read_aloud", "instant_composition"]);
  assert.equal(new Set(session.map((item) => item.knowledge.id)).size, 3);
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
