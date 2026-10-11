import assert from "node:assert/strict";
import test from "node:test";
import { pastAnswers } from "../src/lib/answerHistory.ts";
import type { QuizLog } from "../src/types.ts";

const CARD = "123e4567-e89b-42d3-a456-426614174001";
const OTHER = "123e4567-e89b-42d3-a456-426614174002";

function log(id: number, overrides: Partial<QuizLog>): QuizLog {
  return {
    id, knowledge_id: CARD, asked_on: "2026-10-01", quality: 4, verdict: "正解", format: "一問一答", note: null,
    created_at: "2026-10-01T00:00:00Z", question: null, user_answer: null, correct_answer: null, explanation: null,
    answered_at: null, confirmed_at: null, review_queue_id: null, ...overrides,
  };
}

test("過去の回答は、そのカードだけを回答時刻の新しい順に返し、いま答えた問題の記録を除く", () => {
  const logs = [
    log(1, { created_at: "2026-09-01T00:00:00Z" }),
    log(2, { answered_at: "2026-10-05T01:00:00Z", created_at: "2026-10-05T03:00:00Z", review_queue_id: 10 }),
    log(3, { knowledge_id: OTHER, created_at: "2026-10-09T00:00:00Z" }),
    log(4, { answered_at: "2026-10-10T00:00:00Z", created_at: "2026-10-10T00:00:00Z", review_queue_id: 99 }),
    log(5, { created_at: "2026-10-07T00:00:00Z", review_queue_id: 11 }),
  ];
  assert.deepEqual(pastAnswers(logs, CARD, 99).map((entry) => entry.id), [5, 2, 1]);
  assert.deepEqual(pastAnswers(logs, OTHER, 99).map((entry) => entry.id), [3]);
});
