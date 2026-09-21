import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDailyReviewStatus, parseKnowledge, parsePageEnvelope, parseQuizGradeResponse, parseQuizLog,
  parseQuizStartResponse,
} from "../src/lib/apiValidation.ts";
import { ApiError, getKnowledge, startQuiz } from "../src/lib/api.ts";

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
    category: "技術",
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
  assert.deepEqual(parseQuizGradeResponse({ results: [result], failures: [] }), {
    results: [result], failures: [],
  });
  assert.throws(
    () => parseQuizGradeResponse({ results: [{ ...result, priority: "最優先" }], failures: [] }),
    /priority/,
  );
  assert.throws(
    () => parseQuizGradeResponse({ results: [{ ...result, content_version: 0 }], failures: [] }),
    /content_version/,
  );
  assert.throws(
    () => parseQuizGradeResponse({ results: [{ ...result, category: null }], failures: [] }),
    /category/,
  );
  assert.deepEqual(parseQuizGradeResponse({
    results: [],
    failures: [{
      index: 1, id: result.id, phase: "grading", error: "採点できませんでした。", recorded: false,
    }],
  }).failures[0].phase, "grading");
  assert.throws(
    () => parseQuizGradeResponse({
      results: [],
      failures: [
        { index: 0, id: null, phase: "grading", error: "a", recorded: false },
        { index: 0, id: null, phase: "grading", error: "b", recorded: false },
      ],
    }),
    /failures/,
  );
});

test("日次復習のカテゴリ別残数を検証する", () => {
  const status = {
    review_on: "2026-09-21",
    limit: 15,
    total: 18,
    completed: 8,
    completed_unique: 6,
    remaining: 10,
    due_total: 10,
    overdue_total: 4,
    retry_ready: 2,
    retry_waiting: 1,
    next_retry_at: null,
    remaining_by_category: [
      { category: "英語", count: 6 },
      { category: "SAP", count: 4 },
      { category: "経済", count: 0 },
    ],
  };
  assert.deepEqual(parseDailyReviewStatus(status), status);
  assert.throws(
    () => parseDailyReviewStatus({
      ...status,
      remaining_by_category: [{ category: "英語", count: 9 }],
    }),
    /日次復習キュー/,
  );
  assert.throws(
    () => parseDailyReviewStatus({
      ...status,
      remaining_by_category: [
        { category: "英語", count: 6 },
        { category: "英語", count: 4 },
      ],
    }),
    /remaining_by_category/,
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

test("問題生成APIの診断情報を画面用エラーとして保持する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "問題生成に失敗しました。",
    stage: "AI応答の確認",
    reason: "再生成後も1問が出題条件を満たしませんでした。",
    action: "もう一度出題してください。",
    details: ["1問目「テスト」: 選択肢が3件です（4件必要です）。"],
    reference: "req_test_123",
  }, { status: 502 });
  try {
    await assert.rejects(
      startQuiz([], 5, "四択"),
      (error: unknown) => {
        assert.equal(error instanceof ApiError, true);
        if (!(error instanceof ApiError)) return false;
        assert.equal(error.status, 502);
        assert.equal(error.stage, "AI応答の確認");
        assert.match(error.reason ?? "", /1問/);
        assert.deepEqual(error.details, ["1問目「テスト」: 選択肢が3件です（4件必要です）。"]);
        assert.equal(error.reference, "req_test_123");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
