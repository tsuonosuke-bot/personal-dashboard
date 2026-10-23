import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeAnswers, knowledgeMasteryChanges } from "../src/lib/knowledgeReviewHistory.ts";
import type { MasteryHistoryEvent, QuizLog } from "../src/types.ts";

const answer = (id: number, knowledgeId: string, created: string, answered: string | null = null): QuizLog => ({
  id, knowledge_id: knowledgeId, asked_on: "2026-10-01", created_at: created, answered_at: answered,
  quality: 3, verdict: "部分正解", format: "一問一答", note: null, question: null,
  user_answer: null, correct_answer: null, explanation: null, confirmed_at: null, review_queue_id: null,
});
test("カードごとの履歴は採点時刻より回答時刻を優先し、別カードを含めず元配列を変えない", () => {
  const rows = [answer(1, "a", "2026-10-23T08:00:00Z", "2026-10-20T10:00:00+09:00"),
    answer(2, "a", "2026-10-21T00:00:00Z"), answer(3, "b", "2026-10-22T00:00:00Z"),
    answer(4, "a", "2026-10-21T00:00:00Z"), answer(5, "a", "2026-10-21T00:00:00Z", "2026-10-20T20:00:00-05:00")];
  assert.deepEqual(knowledgeAnswers(rows, "a").map((row) => row.id), [5, 4, 2, 1]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(knowledgeAnswers(rows, "missing"), []);
  assert.equal(knowledgeAnswers(rows, "a").find((row) => row.id === 2)?.answered_at, null);
});
test("習熟度は同じカードの直前の記録から組み立て、基準点より前の値を作らない", () => {
  const rows: MasteryHistoryEvent[] = [
    { id: 3, knowledge_id: "a", to_mastery: "習得中", is_baseline: false, changed_at: "2026-10-03T00:00:00Z" },
    { id: 1, knowledge_id: "a", to_mastery: "未学習", is_baseline: true, changed_at: "2026-10-01T00:00:00Z" },
    { id: 9, knowledge_id: "b", to_mastery: "定着", is_baseline: false, changed_at: "2026-10-02T00:00:00Z" },
    { id: 2, knowledge_id: "a", to_mastery: "学習中", is_baseline: false, changed_at: "2026-10-02T00:00:00Z" },
  ];
  assert.deepEqual(knowledgeMasteryChanges(rows, "a").map((event) => [event.id, event.from_mastery, event.to_mastery]), [
    [3, "学習中", "習得中"], [2, "未学習", "学習中"], [1, null, "未学習"],
  ]);
  assert.equal(knowledgeMasteryChanges(rows, "b")[0].from_mastery, null);
  assert.deepEqual(rows.map((row) => row.id), [3, 1, 9, 2]);
});
