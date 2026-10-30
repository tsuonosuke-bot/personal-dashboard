import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../../hub/functions/knowledge/api/insights/analyze.ts";
import { createInsightAnalysisRequests } from "../src/lib/insightAnalysisRequests.ts";
import type { InsightAnalysis } from "../src/types.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "test", ANTHROPIC_API_KEY: "test" };
const sourceId = "123e4567-e89b-42d3-a456-426614174000";
const theme = { title: "相手が動ける依頼", guiding_question: "依頼するときに何を添える？", summary: "期限と目的を添える。", importance: "複数の示唆に現れる。", insight_ids: [1, 2] };
const analysis: InsightAnalysis = { themes: [theme], analyzed_count: 2 };

function request(method = "GET", body?: unknown) {
  return new Request("https://dashboard.example/api/insights/analyze", {
    method, headers: { Origin: "https://dashboard.example", "X-Dashboard-Action": "knowledge-insight", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withBackend(run: (state: ReturnType<typeof backend>) => Promise<void>) {
  const state = backend();
  const original = globalThis.fetch;
  globalThis.fetch = state.fetch;
  try { await run(state); } finally { globalThis.fetch = original; }
}

function backend() {
  const state = {
    insights: [{ id: 1, knowledge_id: sourceId, body: "依頼に期限を添える" }, { id: 2, knowledge_id: sourceId, body: "依頼の目的を伝える" }],
    sources: [{ id: sourceId, title: "依頼の基本", category: "仕事" }],
    cache: new Map<string, Record<string, unknown>>(),
    aiCalls: 0, cacheReadFails: false, cacheWriteFails: false, aiFails: false,
    fetch: null as unknown as typeof fetch,
  };
  state.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/knowledge_insights") {
      assert.equal(url.searchParams.get("limit"), "300");
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
      return Response.json(state.insights);
    }
    if (url.pathname === "/rest/v1/knowledge") return Response.json(state.sources);
    if (url.pathname === "/rest/v1/insight_analysis_cache") {
      if (init?.method === "POST") {
        assert.match(new Headers(init.headers).get("Prefer") ?? "", /resolution=merge-duplicates/);
        if (state.cacheWriteFails) return Response.json({ error: "offline" }, { status: 503 });
        const value = JSON.parse(String(init.body)) as Record<string, unknown>;
        state.cache.set(String(value.input_hash), value);
        return Response.json([value]);
      }
      if (state.cacheReadFails) return Response.json({ error: "offline" }, { status: 503 });
      const hash = url.searchParams.get("input_hash")?.replace(/^eq\./, "") ?? "";
      assert.match(hash, /^[a-f0-9]{64}$/);
      return Response.json(state.cache.has(hash) ? [state.cache.get(hash)] : []);
    }
    if (url.hostname === "api.anthropic.com") {
      state.aiCalls += 1;
      if (state.aiFails) return Response.json({ error: { type: "overloaded_error", message: "busy" } }, { status: 503 });
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ themes: [theme] }) }] });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return state;
}

test("まとめの表示だけではAIを呼ばず、保存後はGETと通常のPOSTの両方で再利用する", async () => {
  await withBackend(async (state) => {
    assert.equal(await (await onRequest({ request: request(), env })).json(), null);
    assert.equal(state.aiCalls, 0);
    const first = await (await onRequest({ request: request("POST"), env })).json();
    assert.equal(first.saved, true);
    assert.equal(first.reused, false);
    assert.equal(state.aiCalls, 1);
    for (const method of ["GET", "POST"]) {
      const reused = await (await onRequest({ request: request(method), env })).json();
      assert.equal(reused.reused, true);
      assert.equal(reused.input_hash, first.input_hash);
      assert.equal(reused.analyzed_at, first.analyzed_at);
      assert.deepEqual(reused.themes, first.themes);
    }
    assert.equal(state.aiCalls, 1);
    assert.equal(state.cache.size, 1);
  });
});

test("明示的な再分析だけは一致する保存結果があってもAIを呼び直す", async () => {
  await withBackend(async (state) => {
    await onRequest({ request: request("POST"), env });
    const result = await (await onRequest({ request: request("POST", { force: true }), env })).json();
    assert.equal(result.reused, false);
    assert.equal(result.saved, true);
    assert.equal(state.aiCalls, 2);
    assert.equal(state.cache.size, 1);
  });
});

test("示唆本文・出典名・カテゴリ・件数が変わったら、古いまとめを表示も再利用もしない", async () => {
  await withBackend(async (state) => {
    await onRequest({ request: request("POST"), env });
    const changes = [
      () => { state.insights[0].body = "期限に加えて目的も添える"; },
      () => { state.sources[0].title = "依頼の見直し"; },
      () => { state.sources[0].category = "文章"; },
      () => { state.insights.push({ id: 3, knowledge_id: sourceId, body: "次の行動を示す" }); },
    ];
    for (const [index, change] of changes.entries()) {
      change();
      assert.equal(await (await onRequest({ request: request(), env })).json(), null);
      assert.equal(state.aiCalls, index + 1);
      const generated = await (await onRequest({ request: request("POST"), env })).json();
      assert.equal(generated.reused, false);
      assert.equal(generated.analyzed_count, state.insights.length);
      assert.equal(state.aiCalls, index + 2);
    }
    state.insights = state.insights.slice(0, 1);
    assert.equal(await (await onRequest({ request: request(), env })).json(), null);
    assert.equal((await onRequest({ request: request("POST"), env })).status, 400);
    assert.equal(state.aiCalls, 5);
  });
});

test("壊れた保存結果を表示せず、保存先の読取失敗ではAIへ再送しない", async () => {
  await withBackend(async (state) => {
    await onRequest({ request: request("POST"), env });
    const stored = [...state.cache.values()][0];
    stored.analysis = { themes: [{ ...theme, insight_ids: [999] }], analyzed_count: 2 };
    assert.equal(await (await onRequest({ request: request(), env })).json(), null);
    assert.equal(state.aiCalls, 1);
    state.cacheReadFails = true;
    assert.equal((await onRequest({ request: request("POST"), env })).status, 502);
    assert.equal(state.aiCalls, 1);
  });
});

test("保存だけが失敗しても生成結果は返し、再分析のAI失敗では前回の保存結果を残す", async () => {
  await withBackend(async (state) => {
    state.cacheWriteFails = true;
    const unsaved = await (await onRequest({ request: request("POST"), env })).json();
    assert.equal(unsaved.saved, false);
    assert.deepEqual(unsaved.themes, [theme]);
    state.cacheWriteFails = false;
    const saved = await (await onRequest({ request: request("POST"), env })).json();
    state.aiFails = true;
    assert.notEqual((await onRequest({ request: request("POST", { force: true }), env })).status, 200);
    const restored = await (await onRequest({ request: request(), env })).json();
    assert.equal(restored.analyzed_at, saved.analyzed_at);
    assert.deepEqual(restored.themes, saved.themes);
    assert.equal(state.aiCalls, 3);
  });
});

test("再分析の入力や送信元が不正ならDBとAIへ届かない", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Must not fetch"); };
  try {
    for (const body of [{ force: "true" }, { force: true, input_hash: "x" }, [], null]) {
      assert.equal((await onRequest({ request: request("POST", body), env })).status, 400);
    }
    assert.equal((await onRequest({ request: new Request("https://dashboard.example/api/insights/analyze", { method: "POST" }), env })).status, 403);
    assert.equal((await onRequest({ request: request("DELETE"), env })).status, 405);
  } finally { globalThis.fetch = original; }
});

test("画面を切り替えて戻っても、同じ入力の実行中分析は二重依頼しない", async () => {
  const requests = createInsightAnalysisRequests();
  let finish!: (result: InsightAnalysis) => void;
  let calls = 0;
  const first = requests.run("same input", () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const returned = requests.run("same input", () => { throw new Error("Duplicate analysis"); });
  assert.equal(first, returned);
  assert.equal(requests.get("same input"), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(analysis);
  assert.deepEqual(await returned, analysis);
  assert.equal(requests.get("same input"), undefined);
  await requests.run("same input", async () => { calls += 1; return analysis; });
  assert.equal(calls, 2);
});

test("異なる入力は実行中の分析と混ぜず、失敗した実行は再試行できる", async () => {
  const requests = createInsightAnalysisRequests();
  await assert.rejects(requests.run("changed", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(requests.get("changed"), undefined);
  assert.deepEqual(await requests.run("changed", async () => analysis), analysis);
  const results = await Promise.all([requests.run("old", async () => analysis), requests.run("new", async () => ({ ...analysis, analyzed_count: 3 }))]);
  assert.deepEqual(results.map((item) => item.analyzed_count), [2, 3]);
});

test("保存結果の表はservice_roleだけが読書きし、元の示唆や学習記録を変更しない", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261022100000_insight_analysis_cache.sql", import.meta.url), "utf8");
  assert.match(sql, /insight_analysis_cache enable row level security/);
  assert.match(sql, /revoke all on table public\.insight_analysis_cache from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.insight_analysis_cache to service_role/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.(?:knowledge|knowledge_insights|quiz_log|speaking_practice_log)\b/);
});
