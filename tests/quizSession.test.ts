import assert from "node:assert/strict";
import test from "node:test";
import { issueQuizToken, verifyQuizToken } from "../functions/_shared/quizSession.ts";

const env = {
  QUIZ_SIGNING_SECRET: "quiz-signing-secret-that-is-longer-than-thirty-two-characters",
};
const request = new Request("https://dashboard.example/api/quiz/grade");
const item = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  question: "署名された問題",
  format: "四択" as const,
  choices: ["正解", "誤答A", "誤答B", "誤答C"],
};

test("クイズトークンは問題文・形式・選択肢を署名して復元する", async () => {
  const issued = await issueQuizToken(item, request, env, Date.UTC(2026, 8, 20));
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const verified = await verifyQuizToken(issued.token, request, env, Date.UTC(2026, 8, 20));
  assert.deepEqual(verified, { ok: true, value: item });
});

test("改ざん・別ホスト・期限切れのクイズトークンを拒否する", async () => {
  const now = Date.UTC(2026, 8, 20);
  const issued = await issueQuizToken(item, request, env, now);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const last = issued.token.at(-1) === "a" ? "b" : "a";
  const tampered = `${issued.token.slice(0, -1)}${last}`;
  assert.equal((await verifyQuizToken(tampered, request, env, now)).ok, false);
  assert.equal((await verifyQuizToken(
    issued.token,
    new Request("https://other.example/api/quiz/grade"),
    env,
    now,
  )).ok, false);
  assert.equal((await verifyQuizToken(issued.token, request, env, now + 2 * 60 * 60 * 1_000 + 6_000)).ok, false);
});

test("短すぎる署名秘密ではフェイルクローズする", async () => {
  const issued = await issueQuizToken(item, request, { QUIZ_SIGNING_SECRET: "short" });
  assert.deepEqual(issued, { ok: false, status: 503, error: "サーバーのクイズ署名設定が未完了です。" });
});
