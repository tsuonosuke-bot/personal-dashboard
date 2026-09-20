import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
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
  const valid = await readQuizJsonBody(quizRequest('{"categories":[]}'));
  assert.equal(valid.ok, true);
  const malformed = await readQuizJsonBody(quizRequest("{"));
  assert.deepEqual(malformed, { ok: false, status: 400, error: "JSONの形式が正しくありません。" });
});

test("出題要求のcategories/limit/formatを検証し、既定値を補う", () => {
  assert.deepEqual(
    validateStartRequest({}),
    { ok: true, value: { categories: [], limit: 15, format: "おまかせ" } },
  );
  assert.deepEqual(
    validateStartRequest({ categories: ["英語", " 歴史 ", "英語"], limit: 5, format: "四択" }),
    { ok: true, value: { categories: ["英語", "歴史"], limit: 5, format: "四択" } },
  );
  assert.equal(validateStartRequest({ categories: "英語" }).ok, false);
  assert.equal(validateStartRequest({ categories: [""] }).ok, false);
  assert.equal(validateStartRequest({ categories: [1] }).ok, false);
  assert.equal(validateStartRequest({ categories: ["x".repeat(101)] }).ok, false);
  assert.equal(validateStartRequest({ limit: 0 }).ok, false);
  assert.equal(validateStartRequest({ limit: MAX_QUIZ_LIMIT + 1 }).ok, false);
  assert.equal(validateStartRequest({ limit: 1.5 }).ok, false);
  for (const format of ["一問一答", "四択", "記述説明", "産出", "おまかせ"]) {
    assert.equal(validateStartRequest({ format }).ok, true, format);
  }
  assert.equal(validateStartRequest({ format: "ソクラテス式" }).ok, false);
  assert.equal(validateStartRequest({ format: "穴埋め" }).ok, false);
  assert.equal(validateStartRequest({ format: 1 }).ok, false);
});

test("採点要求のid/answer/format/questionを検証し、重複IDを拒否する", () => {
  const id1 = "123e4567-e89b-42d3-a456-426614174000";
  const id2 = "223e4567-e89b-42d3-a456-426614174000";
  // formatを送らない古いクライアントは一問一答として扱い、questionが欠けていても採点は続けられる。
  assert.deepEqual(
    validateGradeRequest([
      { id: id1, answer: " ok ", format: "四択", question: " 問題文 " },
      { id: id2, answer: "" },
    ]),
    {
      ok: true,
      value: [
        { id: id1, answer: "ok", format: "四択", question: "問題文" },
        { id: id2, answer: "", format: "一問一答", question: "" },
      ],
    },
  );
  assert.equal(validateGradeRequest([{ id: id1, answer: "x", format: "おまかせ" }]).ok, false);
  assert.equal(validateGradeRequest([{ id: id1, answer: "x", format: "穴埋め" }]).ok, false);
  assert.equal(
    validateGradeRequest([{ id: id1, answer: "x", question: "x".repeat(MAX_QUESTION_CHARS + 1) }]).ok,
    false,
  );
  assert.equal(validateGradeRequest([{ id: id1, answer: "x", question: 1 }]).ok, false);
  assert.equal(validateGradeRequest([]).ok, false);
  assert.equal(validateGradeRequest([{ id: "not-a-uuid", answer: "x" }]).ok, false);
  assert.equal(validateGradeRequest([{ id: id1, answer: "x" }, { id: id1, answer: "y" }]).ok, false);
  assert.equal(validateGradeRequest([{ id: id1, answer: "x".repeat(MAX_ANSWER_CHARS + 1) }]).ok, false);
  assert.equal(validateGradeRequest(Array.from({ length: 31 }, () => ({ id: id1, answer: "x" }))).ok, false);
});
