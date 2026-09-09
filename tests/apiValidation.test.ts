import assert from "node:assert/strict";
import test from "node:test";
import { parseKnowledge, parsePageEnvelope, parseQuizLog } from "../src/lib/apiValidation.ts";
import { getKnowledge } from "../src/lib/api.ts";

function validKnowledge() {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "テスト",
    explanation: null,
    source_note: null,
    category: "技術",
    mastery: "学習中",
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
    mastery_streak: 1,
    archived: false,
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
