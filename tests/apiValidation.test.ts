import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKnowledge, parsePageEnvelope, parseQuizGradeResponse, parseQuizLog, parseQuizStartResponse,
} from "../src/lib/apiValidation.ts";
import { getKnowledge } from "../src/lib/api.ts";

function validKnowledge() {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "テスト",
    explanation: null,
    source_note: null,
    category: "技術",
    mastery: "学習中",
    priority: "最高",
    ef: 2.5,
    reps: 1,
    interval_days: 2,
    times_asked: 3,
    times_correct: 2,
    learned_on: "2026-09-01",
    last_asked_on: null,
    tags: ["API"],
    accuracy: 2 / 3,
    next_review_on: "2026-09-10",
    next_review_at: "2026-09-10T03:00:00Z",
    stability_hours: 48,
    relearning_stage: null,
    last_reviewed_at: null,
    mastery_streak: 1,
    archived: false,
    content_version: 1,
    created_at: "2026-09-01T00:00:00Z",
  };
}

test("ページ応答とナレッジの全フィールドを検証する", () => {
  const row = validKnowledge();
  const page = parsePageEnvelope({ items: [row], total: 1, limit: 1000, offset: 0 });
  assert.equal(page.total, 1);
  assert.deepEqual(parseKnowledge(page.items[0]), row);
});

test("壊れたタグやページ情報を受理しない", () => {
  assert.throws(() => parseKnowledge({ ...validKnowledge(), tags: null }), /tags/);
  assert.throws(() => parseKnowledge({ ...validKnowledge(), priority: "最優先" }), /priority/);
  assert.throws(
    () => parsePageEnvelope({ items: [], total: -1, limit: 1000, offset: 0 }),
    /total/,
  );
});

test("クイズ判定の許可値を検証する", () => {
  const row = {
    id: 1,
    knowledge_id: "123e4567-e89b-42d3-a456-426614174000",
    asked_on: "2026-09-09",
    quality: 5,
    verdict: "正解",
    format: "free_text",
    note: null,
    created_at: "2026-09-09T00:00:00Z",
  };
  assert.deepEqual(parseQuizLog(row), row);
  assert.throws(() => parseQuizLog({ ...row, verdict: "unknown" }), /verdict/);
});

test("出題の形式と選択肢の食い違いを受理しない", () => {
  const token = "signed-token".repeat(3);
  const free = { id: "a", question: "問題", format: "記述説明", choices: null, token };
  assert.deepEqual(parseQuizStartResponse({ items: [free] }).items, [free]);

  const choice = {
    id: "a", question: "問題", format: "四択", choices: ["ア", "イ", "ウ", "エ"], token,
  };
  assert.deepEqual(parseQuizStartResponse({ items: [choice] }).items, [choice]);

  assert.throws(() => parseQuizStartResponse({ items: [{ ...free, format: "ソクラテス式" }] }), /format/);
  // 四択なのに選択肢がない／四択でないのに選択肢がある、のどちらも通さない。
  assert.throws(() => parseQuizStartResponse({ items: [{ ...choice, choices: null }] }), /choices/);
  assert.throws(() => parseQuizStartResponse({ items: [{ ...free, choices: ["ア"] }] }), /choices/);
  assert.throws(() => parseQuizStartResponse({ items: [{ ...choice, choices: ["ア", "ア", "ウ", "エ"] }] }), /choices/);
  assert.throws(() => parseQuizStartResponse({ items: [{ ...free, token: "" }] }), /token/);
});

test("採点結果の優先度と更新バージョンを検証する", () => {
  const result = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "テスト",
    priority: "高",
    content_version: 3,
    verdict: "正解",
    quality: 5,
    correct_answer: "模範解答",
    explanation: "解説",
    next_review_on: "2026-09-21",
    next_review_at: "2026-09-21T03:00:00Z",
    stability_hours: 72,
    relearning_stage: null,
    schedule_updated: true,
    recorded: true,
  };
  assert.deepEqual(parseQuizGradeResponse({ results: [result] }), [result]);
  assert.throws(
    () => parseQuizGradeResponse({ results: [{ ...result, priority: "最優先" }] }),
    /priority/,
  );
  assert.throws(
    () => parseQuizGradeResponse({ results: [{ ...result, content_version: 0 }] }),
    /content_version/,
  );
});

test("固定上限で切らず、全ページのナレッジを取得する", async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 1_001 }, (_, index) => ({
    ...validKnowledge(),
    id: `knowledge-${index}`,
    archived: index === 1_000,
  }));
  const offsets: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://dashboard.example");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const effectiveLimit = Math.min(limit, 600);
    offsets.push(offset);
    return Response.json({
      items: rows.slice(offset, offset + effectiveLimit),
      total: null,
      limit,
      offset,
    });
  };
  try {
    const result = await getKnowledge();
    assert.equal(result.length, 1_001);
    assert.deepEqual(offsets, [0, 600, 1_001]);
    assert.equal(result.at(-1)?.archived, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
