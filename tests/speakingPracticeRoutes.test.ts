import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/speaking-practice.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

const input = {
  attempt_id: "123e4567-e89b-42d3-a456-426614174001",
  session_id: "123e4567-e89b-42d3-a456-426614174002",
  knowledge_id: "123e4567-e89b-42d3-a456-426614174000",
  practice_type: "instant_composition",
  rating: "smooth",
  answer_text: "Would you mind doing the review?",
  repetitions: 1,
};

test("練習履歴APIは期間と新しい順を固定して取得する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (request) => {
    seenUrl = String(request);
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  };
  try {
    const from = "2026-09-14T00:00:00.000Z";
    const response = await onRequest({
      request: new Request(`https://dashboard.example/api/speaking-practice?from=${encodeURIComponent(from)}&limit=50&offset=0`),
      env,
    });
    assert.equal(response.status, 200);
    assert.match(decodeURIComponent(seenUrl), /practiced_at=gte\.2026-09-14T00:00:00.000Z/);
    assert.match(decodeURIComponent(seenUrl), /order=practiced_at.desc,id.desc/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("練習記録APIは検証済みの値だけを冪等RPCへ渡す", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_request, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json([{ id: 1, ...input, practiced_at: "2026-09-21T00:00:00.000Z" }]);
  };
  try {
    const response = await onRequest({
      request: new Request("https://dashboard.example/api/speaking-practice", {
        method: "POST",
        headers: {
          Origin: "https://dashboard.example",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "speaking-practice",
        },
        body: JSON.stringify(input),
      }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(body?.p_attempt_id, input.attempt_id);
    assert.equal(body?.p_knowledge_id, input.knowledge_id);
    assert.equal(body?.p_practice_type, "instant_composition");
    assert.equal(body?.p_answer_text, input.answer_text);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("練習記録APIは送信元、種別、回数を検証する", async () => {
  const missingOrigin = await onRequest({
    request: new Request("https://dashboard.example/api/speaking-practice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "speaking-practice" },
      body: JSON.stringify(input),
    }),
    env,
  });
  assert.equal(missingOrigin.status, 403);

  const invalid = await onRequest({
    request: new Request("https://dashboard.example/api/speaking-practice", {
      method: "POST",
      headers: {
        Origin: "https://dashboard.example",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "speaking-practice",
      },
      body: JSON.stringify({ ...input, practice_type: "quiz", repetitions: 0 }),
    }),
    env,
  });
  assert.equal(invalid.status, 400);
});
