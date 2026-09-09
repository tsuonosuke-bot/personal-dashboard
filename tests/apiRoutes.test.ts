import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as knowledgeRoute } from "../functions/api/knowledge.ts";
import { onRequest as knowledgeItemRoute } from "../functions/api/knowledge/[id].ts";
import { onRequest as quizLogRoute } from "../functions/api/quiz-log.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

test("knowledge APIはアーカイブ状態とページ範囲を固定して転送する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenHeaders: Record<string, string> | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenHeaders = init?.headers as Record<string, string>;
    return Response.json([{ id: "row-1" }], {
      headers: { "Content-Range": "50-50/123" },
    });
  };
  try {
    const response = await knowledgeRoute({
      request: new Request("https://dashboard.example/api/knowledge?status=archived&limit=25&offset=50"),
      env,
    });
    assert.equal(response.status, 200);
    assert.match(seenUrl, /archived=eq.true/);
    assert.match(seenUrl, /limit=25/);
    assert.match(seenUrl, /offset=50/);
    assert.equal(seenHeaders?.Prefer, "count=exact");
    assert.deepEqual(await response.json(), {
      items: [{ id: "row-1" }],
      total: 123,
      limit: 25,
      offset: 50,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("knowledge APIは不正なページ指定と状態を拒否する", async () => {
  const badLimit = await knowledgeRoute({
    request: new Request("https://dashboard.example/api/knowledge?limit=1001"),
    env,
  });
  assert.equal(badLimit.status, 400);
  const badStatus = await knowledgeRoute({
    request: new Request("https://dashboard.example/api/knowledge?status=deleted"),
    env,
  });
  assert.equal(badStatus.status, 400);
});

test("quiz-log APIは新しい履歴から安定順で取得する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  };
  try {
    const response = await quizLogRoute({
      request: new Request("https://dashboard.example/api/quiz-log?limit=100&offset=0"),
      env,
    });
    assert.equal(response.status, 200);
    assert.match(decodeURIComponent(seenUrl), /order=asked_on.desc,created_at.desc,id.desc/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("knowledge item APIはアーカイブ解除を1件だけに適用する", async () => {
  const originalFetch = globalThis.fetch;
  const id = "123e4567-e89b-42d3-a456-426614174000";
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id, archived: false }]);
  };
  try {
    const response = await knowledgeItemRoute({
      request: new Request(`https://dashboard.example/api/knowledge/${id}`, {
        method: "PATCH",
        headers: {
          Origin: "https://dashboard.example",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "knowledge-write",
        },
        body: JSON.stringify({ archived: false }),
      }),
      env,
      params: { id },
    });
    assert.equal(response.status, 200);
    assert.match(seenUrl, new RegExp(`id=eq(?:\\.|%2E)${id}`));
    assert.equal(seenInit?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), { archived: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
