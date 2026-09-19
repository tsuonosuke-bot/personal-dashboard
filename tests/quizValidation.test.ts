import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ANSWER_CHARS,
  MAX_QUIZ_LIMIT,
  QUIZ_ACTION_HEADER,
  readQuizJsonBody,
  validateGradeRequest,
  validateQuizRequest,
  validateStartRequest,
} from "../functions/_shared/quizValidation.ts";

function quizRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/quiz/start", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": QUIZ_ACTION_HEADER,
      ...headers,
    },
    body,
  });
}

test("クイズ要求は同一オリジン・専用ヘッダー・JSONを必須にする", () => {
  assert.equal(validateQuizRequest(quizRequest("{}")), null);
  assert.equal(validateQuizRequest(quizRequest("{}", { Origin: "https://attacker.example" }))?.status, 403);
  assert.equal(validateQuizRequest(quizRequest("{}", { "X-Dashboard-Action": "knowledge-write" }))?.status, 403);
  assert.equal(validateQuizRequest(quizRequest("{}", { "Content-Type": "text/plain" }))?.status, 415);
});

test("JSON本文の構文を検証する", async () => {
  const valid = await readQuizJsonBody(quizRequest('{"mode":"all"}'));
  assert.equal(valid.ok, true);
  const malformed = await readQuizJsonBody(quizRequest("{"));
  assert.deepEqual(malformed, { ok: false, status: 400, error: "JSONの形式が正しくありません。" });
});

test("出題要求のmode/limitを検証し、既定値を補う", () => {
  assert.deepEqual(validateStartRequest({}), { ok: true, value: { mode: "all", limit: 15 } });
  assert.deepEqual(
    validateStartRequest({ mode: "english", limit: 5 }),
    { ok: true, value: { mode: "english", limit: 5 } },
  );
  assert.equal(validateStartRequest({ mode: "japanese" }).ok, false);
  assert.equal(validateStartRequest({ limit: 0 }).ok, false);
  assert.equal(validateStartRequest({ limit: MAX_QUIZ_LIMIT + 1 }).ok, false);
  assert.equal(validateStartRequest({ limit: 1.5 }).ok, false);
});

test("採点要求のid/answerを検証し、重複IDを拒否する", () => {
  const id1 = "123e4567-e89b-42d3-a456-426614174000";
  const id2 = "223e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(
    validateGradeRequest([{ id: id1, answer: " ok " }, { id: id2, answer: "" }]),
    { ok: true, value: [{ id: id1, answer: "ok" }, { id: id2, answer: "" }] },
  );
  assert.equal(validateGradeRequest([]).ok, false);
  assert.equal(validateGradeRequest([{ id: "not-a-uuid", answer: "x" }]).ok, false);
  assert.equal(validateGradeRequest([{ id: id1, answer: "x" }, { id: id1, answer: "y" }]).ok, false);
  assert.equal(validateGradeRequest([{ id: id1, answer: "x".repeat(MAX_ANSWER_CHARS + 1) }]).ok, false);
  assert.equal(validateGradeRequest(Array.from({ length: 31 }, () => ({ id: id1, answer: "x" }))).ok, false);
});
