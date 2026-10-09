import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  readingChunks,
  selectSpeakingPracticeKnowledge,
  speakingPracticeCandidates,
  speakingPracticeEmptyReason,
  speakingPracticeGroups,
  speakingPracticeStats,
  speechSynthesisSupported,
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

test("練習の対象をカテゴリ・タグ・カードで絞り、選んだ対象だけから出題する", () => {
  const items = [
    knowledge({ id: "a", title: "Would you mind", category: "英語", tags: ["英語", "依頼"] }),
    knowledge({ id: "b", title: "Let me check", category: "英語", tags: ["英語", "会議"] }),
    knowledge({ id: "c", title: "On the same page", category: "ビジネス英語", tags: ["フレーズ"] }),
    knowledge({ id: "d", title: "非英語カード", category: "英語", tags: ["英語"] }),
  ];
  const ids = (scope: Parameters<typeof selectSpeakingPracticeKnowledge>[3]) =>
    selectSpeakingPracticeKnowledge(items, 15, () => 0.5, scope).map((item) => item.id).sort();
  assert.deepEqual(ids({ kind: "all" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ kind: "category", category: "ビジネス英語" }), ["c"]);
  assert.deepEqual(ids({ kind: "tag", tag: "会議" }), ["b"]);
  assert.deepEqual(ids({ kind: "cards", ids: ["a", "c", "d"] }), ["a", "c"]);
  // カード指定は問題数ではなく選んだ件数で始める
  assert.equal(selectSpeakingPracticeKnowledge(items, 1, () => 0.5, { kind: "cards", ids: ["a", "b"] }).length, 2);
  const groups = speakingPracticeGroups(speakingPracticeCandidates(items));
  assert.deepEqual(groups.categories, [{ name: "ビジネス英語", total: 1 }, { name: "英語", total: 2 }]);
  assert.ok(groups.tags.some((tag) => tag.name === "会議" && tag.total === 1));
});

test("対象が0件のときは始められない理由を返す", () => {
  const candidates = speakingPracticeCandidates([knowledge({ id: "a", category: "英語", tags: ["英語"] })]);
  assert.equal(speakingPracticeEmptyReason(candidates, { kind: "all" }), null);
  assert.match(speakingPracticeEmptyReason(candidates, { kind: "category", category: "歴史" }) ?? "", /カテゴリ「歴史」に練習できる英語カードがありません/);
  assert.match(speakingPracticeEmptyReason(candidates, { kind: "category", category: "" }) ?? "", /カテゴリを選んでください/);
  assert.match(speakingPracticeEmptyReason(candidates, { kind: "tag", tag: "会議" }) ?? "", /タグ「会議」/);
  assert.match(speakingPracticeEmptyReason(candidates, { kind: "cards", ids: [] }) ?? "", /1件以上選んでください/);
  assert.match(speakingPracticeEmptyReason([], { kind: "all" }) ?? "", /英字タイトルを持つナレッジがありません/);
});

test("音声非対応を判定し、代わりに句読点と5語ごとの区切りを示す", () => {
  assert.equal(speechSynthesisSupported({}), false);
  assert.equal(speechSynthesisSupported({ speechSynthesis: {} }), false);
  assert.equal(speechSynthesisSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: function () {} }), true);
  assert.deepEqual(readingChunks("Could you send me the updated report by Friday, if possible?"), [
    "Could you send me the", "updated report by Friday,", "if possible?",
  ]);
});

test("Speaking練習は設定と開始を先に置き、説明は開閉式、非対応時はお手本ボタンを無効にする", async () => {
  const view = await readFile(new URL("../src/components/SpeakingPracticeView.tsx", import.meta.url), "utf8");
  const setup = view.slice(view.indexOf('className="card speaking-setup"'), view.indexOf('phase === "practice"'));
  assert.ok(setup.indexOf("練習する対象") < setup.indexOf("AIで例文を作って始める"));
  assert.ok(setup.indexOf("AIで例文を作って始める") < setup.indexOf('className="speaking-history"'));
  assert.ok(setup.indexOf('className="speaking-history"') < setup.indexOf("<details className=\"speaking-setup-intro\">"));
  assert.match(view, /disabled=\{!speechSupported\}/);
  assert.match(view, /音声の読み上げに対応していないため/);
  assert.match(view, /utterance\.onerror/);
  assert.doesNotMatch(view, /onClick=\{speakSample\}>🔊 お手本を聞く<\/button>/);
});
