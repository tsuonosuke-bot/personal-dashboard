import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../../hub/functions/knowledge/api/insight-actions.ts";
import { actionInboxContent, readActionReference } from "../../hub/functions/knowledge/_shared/insightAction.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
const ref = { sourceType: "insight", sourceId: "42" };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/insight-actions", { method: "POST", headers: {
    Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "insight-action", ...headers,
  }, body: JSON.stringify(body) });
}
async function withFetch(handler: (url: URL, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try { await run(); } finally { globalThis.fetch = original; }
}

test("示唆・日記の行動にDBの本文と出典を添え、未整理Inboxだけに書く", async () => {
  for (const sourceType of ["insight", "journal"] as const) {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    await withFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname.endsWith("/knowledge_insights")) return Response.json([{ id: 42, knowledge_id: knowledgeId, body: "先に判断基準を決める" }]);
      if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId, title: "意思決定の手順" }]);
      if (url.pathname.endsWith("/daily_journal")) return Response.json([{ entry_date: "2026-10-22", summary: "判断基準を先に共有すると相談が進んだ" }]);
      assert.equal(url.pathname, "/rest/v1/idea_inbox");
      return Response.json([{ id: 901, created_at: "2026-10-23T00:00:00Z" }], { status: 201 });
    }, async () => {
      const sourceId = sourceType === "insight" ? "42" : "2026-10-22";
      const response = await onRequest({ request: request({ sourceType, sourceId, note: "  明日の会議前に判断基準を3つ書く  " }), env });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { id: 901, createdAt: "2026-10-23T00:00:00Z" });
      const writes = calls.filter((call) => call.init?.method && call.init.method !== "GET");
      assert.equal(writes.length, 1);
      const body = JSON.parse(String(writes[0].init?.body));
      assert.equal(body.status, "pending");
      assert.equal(body.source, "knowledge-insight-action");
      assert.ok(body.content.startsWith("明日の会議前に判断基準を3つ書く\n\n"));
      assert.ok(body.content.includes(sourceType === "insight" ? "元の示唆: 先に判断基準を決める" : "元の日記: 判断基準を先に共有すると相談が進んだ"));
      assert.ok(body.content.endsWith(`（${sourceType} ${sourceId}）`));
      assert.equal(calls[0].url.searchParams.get(sourceType === "insight" ? "id" : "entry_date"), `eq.${sourceId}`);
    });
  }
});

test("出典ページは指定した1件の現在の本文だけを読み、AIも書き込みも行わない", async () => {
  let calls = 0;
  await withFetch((url, init) => {
    calls++;
    assert.equal(url.pathname, "/rest/v1/daily_journal");
    assert.equal(url.searchParams.get("select"), "entry_date,summary");
    assert.equal(url.searchParams.get("limit"), "1");
    assert.equal(init?.method, "GET");
    return Response.json([{ entry_date: "2026-10-22", summary: "更新後の日記" }]);
  }, async () => {
    const response = await onRequest({ request: new Request("https://dashboard.example/api/insight-actions?sourceType=journal&sourceId=2026-10-22"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sourceType: "journal", sourceId: "2026-10-22", title: "2026-10-22の日記", body: "更新後の日記", knowledgeId: null });
    assert.equal(calls, 1);
  });
});

test("削除済み・取得失敗の出典からはInboxを作らない", async () => {
  for (const failure of [404, 503]) {
    await withFetch((_url, init) => {
      assert.equal(init?.method, "GET");
      return failure === 404 ? Response.json([]) : Response.json({ error: "unavailable" }, { status: 503 });
    }, async () => {
      const response = await onRequest({ request: request({ ...ref, note: "試す" }), env });
      assert.equal(response.status, failure === 404 ? 404 : 502);
    });
  }
});

test("書き込み元・ヘッダー・形式・余分な列・長さをDB接続より先に検証する", async () => {
  await withFetch(() => { throw new Error("must not access database"); }, async () => {
    for (const headers of [{ Origin: "https://evil.example" }, { "X-Dashboard-Action": "inbox-deep-dive" }]) {
      assert.equal((await onRequest({ request: request({ ...ref, note: "試す" }, headers), env })).status, 403);
    }
    assert.equal((await onRequest({ request: request({ ...ref, note: "試す" }, { "Content-Type": "text/plain" }), env })).status, 415);
    for (const input of [{ ...ref, note: " " }, { ...ref, note: "x".repeat(501) }, { ...ref, note: "試す", title: "偽の出典" }, { ...ref, sourceId: "1&limit=100", note: "試す" }, { sourceType: "knowledge", sourceId: knowledgeId, note: "試す" }, { sourceType: "journal", sourceId: "2026-02-30", note: "試す" }]) {
      assert.equal((await onRequest({ request: request(input), env })).status, 400);
    }
    assert.equal((await onRequest({ request: request({ ...ref, note: "x".repeat(4_001) }), env })).status, 413);
    for (const query of ["sourceType=journal&sourceId=2026-02-30", "sourceType=insight&sourceId=42&select=*", "sourceType=insight&sourceId=42&sourceId=43"]) {
      assert.equal((await onRequest({ request: new Request(`https://dashboard.example/api/insight-actions?${query}`), env })).status, 400);
    }
    assert.equal((await onRequest({ request: new Request("https://dashboard.example/api/insight-actions", { method: "DELETE" }), env })).status, 405);
  });
});

test("出典の識別子を厳密に検証し、長い引用でもIdeaで編集できる長さに収める", () => {
  assert.equal(readActionReference("insight", "9007199254740992"), null);
  assert.equal(readActionReference("journal", "2025-02-29"), null);
  assert.deepEqual(readActionReference("journal", "2024-02-29"), { sourceType: "journal", sourceId: "2024-02-29" });
  const content = actionInboxContent("行".repeat(500), { sourceType: "insight", sourceId: "42", title: "題\n名".repeat(100), body: "本文".repeat(2_000), knowledgeId });
  assert.ok(content.length <= 2_000);
  assert.ok(content.includes("…\n\n行動元: "));
  assert.ok(!content.slice(content.lastIndexOf("行動元: ")).includes("\n"));
  const emoji = actionInboxContent("試す", { sourceType: "journal", sourceId: "2026-10-22", title: `${"題".repeat(159)}😀`, body: `${"文".repeat(998)}😀続き`, knowledgeId: null });
  assert.ok(![...emoji].some((char) => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff), "引用を省略しても絵文字の途中で切らない");
});
