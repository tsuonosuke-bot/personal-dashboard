import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDailyReviewStatus, parseKnowledge, parsePageEnvelope, parseQuizLog, parseSpeakingPracticeStart,
} from "../src/lib/apiValidation.ts";
import { ApiError, getKnowledge, runReviewBatch } from "../src/lib/api.ts";

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
  // 自動タグは別のAPIから合わせるので、ここでは空で返す。
  assert.deepEqual(parseKnowledge(page.items[0]), { ...row, auto_tags: [] });
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
  const history = {
    question: null, user_answer: null, correct_answer: null, explanation: null,
    answered_at: null, confirmed_at: null, review_queue_id: null,
  };
  // 履歴の列が無い古い応答も、空の履歴として受け入れる。
  assert.deepEqual(parseQuizLog(row), { ...row, ...history });
  const queued = {
    ...row, question: "Q", user_answer: "A", correct_answer: "C", explanation: "E",
    answered_at: "2026-09-09T00:00:00Z", confirmed_at: null, review_queue_id: 12,
  };
  assert.deepEqual(parseQuizLog(queued), queued);
  assert.throws(() => parseQuizLog({ ...row, verdict: "unknown" }), /verdict/);
  assert.throws(() => parseQuizLog({ ...queued, review_queue_id: "12" }), /review_queue_id/);
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
    new_limit: 10,
    new_held: 3,
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

test("AI英会話出題の必須項目と重複IDを検証する", () => {
  const item = {
    knowledge_id: "123e4567-e89b-42d3-a456-426614174000",
    practice_type: "instant_composition",
    prompt_ja: "会議資料を確認していただけますか。",
    target_en: "Would you mind reviewing the meeting materials?",
  };
  assert.deepEqual(parseSpeakingPracticeStart({ items: [item] }), { items: [item] });
  assert.throws(
    () => parseSpeakingPracticeStart({ items: [item, item] }),
    /knowledge_id/,
  );
  assert.throws(
    () => parseSpeakingPracticeStart({ items: [{ ...item, target_en: "" }] }),
    /target_en/,
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

test("件数が分かれば残りのページを待たずに同時に取り、順番どおりに並べる", async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 2_500 }, (_, index) => ({ ...validKnowledge(), id: `knowledge-${index}` }));
  const offsets: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://dashboard.example");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    offsets.push(offset);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // 後のページほど早く返して、並べ順が応答順に左右されないことを確かめる。
    await new Promise((resolve) => setTimeout(resolve, offset === 1_000 ? 10 : 1));
    inFlight -= 1;
    return Response.json({ items: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
  };
  try {
    const result = await getKnowledge();
    assert.deepEqual(result.map((item) => item.id), rows.map((row) => row.id));
    assert.deepEqual(offsets, [0, 1_000, 2_000]);
    assert.equal(maxInFlight, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("APIの診断情報を画面用エラーとして保持する", async () => {
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
      runReviewBatch("generate"),
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
