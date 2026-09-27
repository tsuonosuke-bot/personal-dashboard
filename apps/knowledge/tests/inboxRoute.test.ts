import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/api/inbox.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};
const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/inbox", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-deep-dive",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function withFetch(handler: (url: URL, init?: RequestInit) => Response, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("深掘りしたい点を出典つきで未整理のInboxへ登録する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId, title: "Would you mind ~ing" }]);
    return Response.json([{ id: 162, created_at: "2026-09-24T01:00:00Z" }], { status: 201 });
  }, async () => {
    const response = await onRequest({ request: request({ knowledgeId, note: "  mind の後が動名詞になる理由  " }), env });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 162, createdAt: "2026-09-24T01:00:00Z" });
    const insert = requests.find((entry) => entry.init?.method === "POST");
    assert.ok(insert);
    assert.equal(insert.url.pathname, "/rest/v1/idea_inbox");
    assert.deepEqual(JSON.parse(String(insert.init?.body)), {
      content: `mind の後が動名詞になる理由\n\n深掘り元: 復習「Would you mind ~ing」（knowledge ${knowledgeId}）`,
      status: "pending",
      source: "knowledge-quiz",
    });
    const lookup = requests.find((entry) => entry.url.pathname.endsWith("/knowledge"));
    assert.equal(lookup?.url.searchParams.get("id"), `eq.${knowledgeId}`);
  });
});

test("存在しないナレッジからは登録しない", async () => {
  let inserted = false;
  await withFetch((url, init) => {
    if (init?.method === "POST") inserted = true;
    return Response.json([]);
  }, async () => {
    const response = await onRequest({ request: request({ knowledgeId, note: "調べる" }), env });
    assert.equal(response.status, 404);
    assert.equal(inserted, false);
  });
});

test("送信元・ヘッダー・入力を検証してからDBへ接続する", async () => {
  await withFetch(() => { throw new Error("should not fetch"); }, async () => {
    assert.equal((await onRequest({ request: request({ knowledgeId, note: "x" }, { Origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await onRequest({ request: request({ knowledgeId, note: "x" }, { "X-Dashboard-Action": "knowledge-write" }), env })).status, 403);
    assert.equal((await onRequest({ request: request({ knowledgeId: "bad", note: "x" }), env })).status, 400);
    assert.equal((await onRequest({ request: request({ knowledgeId, note: "   " }), env })).status, 400);
    assert.equal((await onRequest({ request: request({ knowledgeId, note: "x".repeat(1_001) }), env })).status, 400);
    assert.equal((await onRequest({ request: request({ knowledgeId, note: "x", source: "other" }), env })).status, 400);
    const get = await onRequest({ request: new Request("https://dashboard.example/api/inbox"), env });
    assert.equal(get.status, 405);
  });
});

test("採点結果の各問題からInboxへ登録できる", async () => {
  const view = await readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8");
  assert.match(view, /<DeepDiveInbox knowledgeId=\{result\.id\} title=\{result\.title\} \/>/);
  const api = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(api, /"X-Dashboard-Action": "inbox-deep-dive"/);
});
