import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as startRoute } from "../functions/api/quiz/start.ts";
import { onRequest as gradeRoute } from "../functions/api/quiz/grade.ts";
import { QUIZ_ACTION_HEADER } from "../functions/_shared/quizValidation.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  ANTHROPIC_API_KEY: "anthropic-test-key",
};

const ID_1 = "123e4567-e89b-42d3-a456-426614174000";
const ID_2 = "223e4567-e89b-42d3-a456-426614174000";

function quizPost(path: string, body: unknown) {
  return new Request(`https://dashboard.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": QUIZ_ACTION_HEADER,
    },
    body: JSON.stringify(body),
  });
}

function anthropicToolResponse(name: string, input: unknown) {
  return Response.json({ content: [{ type: "tool_use", name, input }] });
}

test("quiz/start はpick_quizの候補にAI生成の問題文だけを付けて返す（正解は含めない）", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        { id: ID_1, title: "秘密のタイトル1", explanation: "説明1" },
        { id: ID_2, title: "秘密のタイトル2", explanation: "説明2" },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", {
        questions: [
          { id: ID_1, question: "問題1" },
          { id: ID_2, question: "問題2" },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { mode: "all", limit: 15 }),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { items: [{ id: ID_1, question: "問題1" }, { id: ID_2, question: "問題2" }] });
    assert.equal(JSON.stringify(body).includes("秘密のタイトル"), false);
    assert.ok(calls.some((url) => url.includes("/rest/v1/rpc/pick_quiz")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は出題対象が0件なら空配列を返しAIを呼ばない", async () => {
  const originalFetch = globalThis.fetch;
  let anthropicCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) return Response.json([]);
    if (url.includes("api.anthropic.com")) { anthropicCalled = true; return anthropicToolResponse("submit_questions", { questions: [] }); }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [] });
    assert.equal(anthropicCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は同一オリジン・専用ヘッダーを要求する", async () => {
  const response = await startRoute({
    request: new Request("https://dashboard.example/api/quiz/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    env,
  });
  assert.equal(response.status, 403);
});

test("quiz/grade は採点結果をrecord_answers_batchで一括記録し、次回復習日を返す", async () => {
  const originalFetch = globalThis.fetch;
  const seenBatchBodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      return Response.json([
        { id: ID_1, title: "正解1", explanation: "説明1", next_review_on: "2026-09-20" },
        { id: ID_2, title: "正解2", explanation: "説明2", next_review_on: "2026-09-21" },
      ]);
    }
    if (url.includes("/rest/v1/rpc/jst_today")) return Response.json("2026-09-19");
    if (url.includes("/rest/v1/quiz_log")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", {
        grades: [
          { id: ID_1, quality: 5, explanation: "よくできました", note: "完璧に回答した" },
          { id: ID_2, quality: 1, explanation: "惜しい", note: "用語を思い出せなかった" },
        ],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch")) {
      seenBatchBodies.push(JSON.parse(String(init?.body)));
      return Response.json([
        { id: ID_1, next_review_on: "2026-10-03" },
        { id: ID_2, next_review_on: "2026-09-20" },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [
        { id: ID_1, answer: "完璧な回答" },
        { id: ID_2, answer: "わからない" },
      ]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { results: unknown[] };
    assert.deepEqual(body.results, [
      {
        id: ID_1, title: "正解1", verdict: "正解", quality: 5,
        explanation: "よくできました", next_review_on: "2026-10-03", recorded: true,
      },
      {
        id: ID_2, title: "正解2", verdict: "不正解", quality: 1,
        explanation: "惜しい", next_review_on: "2026-09-20", recorded: true,
      },
    ]);
    assert.equal(seenBatchBodies.length, 1);
    const batch = seenBatchBodies[0] as { p_answers: { id: string; format: string }[] };
    assert.equal(batch.p_answers.length, 2);
    assert.equal(batch.p_answers[0].format, "記述説明");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は本日記録済みの項目をrecord_answers_batchに含めない", async () => {
  const originalFetch = globalThis.fetch;
  let batchCalled = false;
  let batchIds: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      return Response.json([
        { id: ID_1, title: "正解1", explanation: "説明1", next_review_on: "2026-09-20" },
      ]);
    }
    if (url.includes("/rest/v1/rpc/jst_today")) return Response.json("2026-09-19");
    if (url.includes("/rest/v1/quiz_log")) return Response.json([{ knowledge_id: ID_1 }]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", {
        grades: [{ id: ID_1, quality: 4, explanation: "OK", note: "note" }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch")) {
      batchCalled = true;
      batchIds = (JSON.parse(String(init?.body)) as { p_answers: { id: string }[] }).p_answers.map((a) => a.id);
      return Response.json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [{ id: ID_1, answer: "回答" }]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { results: { recorded: boolean; next_review_on: string | null }[] };
    assert.equal(body.results[0].recorded, false);
    assert.equal(body.results[0].next_review_on, "2026-09-20");
    assert.equal(batchCalled, false);
    assert.deepEqual(batchIds, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
