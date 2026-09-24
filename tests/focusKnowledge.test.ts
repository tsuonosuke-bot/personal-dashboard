import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as focusKnowledgeRoute } from "../functions/api/focus-knowledge.ts";
import { onRequest as focusRoute } from "../functions/api/focus.ts";

const env = {
  SUPABASE_URL: "https://compass.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
};
const knowledgeId = "6f1b2f5c-9a58-4a2f-8f0e-2b1d7a9c4e31";

function mutation(method: "POST" | "DELETE", body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/focus-knowledge", {
    method,
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": method === "POST" ? "focus-knowledge-link" : "focus-knowledge-unlink",
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

test("ナレッジ検索は未アーカイブのタイトル部分一致だけを返し、ワイルドカードを無効化する", async () => {
  const urls: URL[] = [];
  await withFetch((url) => {
    urls.push(url);
    return Response.json([{ id: knowledgeId, title: "コンウェイの法則", category: "IT" }, { id: "bad", title: "x" }]);
  }, async () => {
    const response = await focusKnowledgeRoute({ request: new Request("https://hub.example/api/focus-knowledge?q=%E6%B3%95%E5%89%87*%_"), env });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<{ id: string; url: string }> };
    assert.deepEqual(body.items.map((item) => item.id), [knowledgeId]);
    assert.equal(body.items[0].url, `/knowledge/?knowledge=${knowledgeId}`);
    assert.equal(urls[0].pathname, "/rest/v1/knowledge");
    assert.equal(urls[0].searchParams.get("archived"), "eq.false");
    assert.equal(urls[0].searchParams.get("title"), "ilike.*法則*");
  });
});

test("空の検索語はSupabaseへ送らない", async () => {
  await withFetch(() => { throw new Error("should not fetch"); }, async () => {
    const response = await focusKnowledgeRoute({ request: new Request("https://hub.example/api/focus-knowledge?q=**"), env });
    assert.equal(response.status, 400);
  });
});

test("Focusにナレッジを紐づけ、重複は無視する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    if (init?.method === "POST") return new Response(null, { status: 201 });
    return Response.json([]);
  }, async () => {
    const response = await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId }), env });
    assert.equal(response.status, 200);
    const insert = requests.find((entry) => entry.init?.method === "POST");
    assert.ok(insert);
    assert.equal(insert.url.pathname, "/rest/v1/focus_knowledge_links");
    assert.match(String((insert.init?.headers as Record<string, string>).Prefer), /resolution=ignore-duplicates/);
    assert.deepEqual(JSON.parse(String(insert.init?.body)), { focus_id: 3, knowledge_id: knowledgeId });
  });
});

test("紐づけは1つのFocusにつき10件まで", async () => {
  await withFetch((_url, init) => {
    if (init?.method === "POST") throw new Error("should not insert");
    return Response.json(Array.from({ length: 10 }, (_, index) => ({ knowledge_id: `id-${index}` })));
  }, async () => {
    const response = await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId }), env });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "1つのFocusに紐づけられるナレッジは10件までです。" });
  });
});

test("存在しないFocusやナレッジへの紐づけは404にする", async () => {
  await withFetch((_url, init) => {
    if (init?.method === "POST") return Response.json({ code: "23503", message: "violates foreign key constraint" }, { status: 409 });
    return Response.json([]);
  }, async () => {
    const response = await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId }), env });
    assert.equal(response.status, 404);
  });
});

test("紐づけ解除は対象の1組だけを削除する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    return new Response(null, { status: 204 });
  }, async () => {
    const response = await focusKnowledgeRoute({ request: mutation("DELETE", { focusId: 3, knowledgeId }), env });
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.method, "DELETE");
    assert.equal(requests[0].url.searchParams.get("focus_id"), "eq.3");
    assert.equal(requests[0].url.searchParams.get("knowledge_id"), `eq.${knowledgeId}`);
  });
});

test("紐づけ更新は送信元・ヘッダー・入力を検証する", async () => {
  await withFetch(() => { throw new Error("should not fetch"); }, async () => {
    assert.equal((await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId }, { Origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId }, { "X-Dashboard-Action": "focus-knowledge-unlink" }), env })).status, 403);
    assert.equal((await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId: "not-uuid" }), env })).status, 400);
    assert.equal((await focusKnowledgeRoute({ request: mutation("POST", { focusId: 0, knowledgeId }), env })).status, 400);
    assert.equal((await focusKnowledgeRoute({ request: mutation("POST", { focusId: 3, knowledgeId, extra: 1 }), env })).status, 400);
  });
});

test("紐づけテーブルを読めなくてもFocus一覧は返す", async () => {
  await withFetch((url) => {
    if (url.pathname.endsWith("/focus_knowledge_links")) return Response.json({ message: "relation does not exist" }, { status: 404 });
    return Response.json([{ id: 1, source_route_id: 10, source_want_id: 20, content: "c", note: null, status: "active", sort_order: 1, created_at: null, updated_at: null }]);
  }, async () => {
    const response = await focusRoute({ request: new Request("https://hub.example/api/focus"), env });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<{ knowledge: unknown[] }>; knowledgeLinksAvailable: boolean };
    assert.equal(body.knowledgeLinksAvailable, false);
    assert.deepEqual(body.items[0].knowledge, []);
  });
});

test("紐づけテーブルはservice roleだけが扱い、Hub管理画面から操作できる", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609240002_focus_knowledge_links.sql", import.meta.url), "utf8");
  assert.match(sql, /references public\.focus_items \(id\) on delete cascade/);
  assert.match(sql, /references public\.knowledge \(id\) on delete cascade/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.focus_knowledge_links from anon;/);
  const hub = await readFile(new URL("../public/hub.js", import.meta.url), "utf8");
  assert.match(hub, /data-focus-action="knowledge-search"/);
  assert.match(hub, /"X-Dashboard-Action": method === "POST" \? "focus-knowledge-link" : "focus-knowledge-unlink"/);
});
