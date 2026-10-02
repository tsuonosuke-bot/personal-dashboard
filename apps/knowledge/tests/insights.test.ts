import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { onRequest as insightsRoute } from "../functions/api/insights.ts";
import { onRequest as insightItemRoute } from "../functions/api/insights/[id].ts";
import { onRequest as analyzeRoute, readThemes } from "../functions/api/insights/analyze.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  ANTHROPIC_API_KEY: "anthropic-test-key",
};
const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
const row = { id: 7, knowledge_id: knowledgeId, body: "依頼メールの書き出しに使う", created_at: "2026-09-24T01:00:00+00:00", updated_at: "2026-09-24T01:00:00+00:00" };

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://dashboard.example${path}`, {
    method,
    headers: {
      Origin: "https://dashboard.example",
      "X-Dashboard-Action": "knowledge-insight",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("示唆をナレッジに付けて保存する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId }]);
    return Response.json([row], { status: 201 });
  }, async () => {
    const response = await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: "  依頼メールの書き出しに使う " }), env });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).id, 7);
    const insert = requests.find((entry) => entry.init?.method === "POST");
    assert.equal(insert?.url.pathname, "/rest/v1/knowledge_insights");
    assert.deepEqual(JSON.parse(String(insert?.init?.body)), { knowledge_id: knowledgeId, body: "依頼メールの書き出しに使う" });
  });
});

test("存在しないナレッジや不正な入力では保存しない", async () => {
  await withFetch((url, init) => {
    if (init?.method === "POST") throw new Error("should not insert");
    return Response.json([]);
  }, async () => {
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: "x" }), env })).status, 404);
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: " " }), env })).status, 400);
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: "x".repeat(1_001) }), env })).status, 400);
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: "bad", body: "x" }), env })).status, 400);
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: "x" }, { Origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await insightsRoute({ request: request("/api/insights", "POST", { knowledge_id: knowledgeId, body: "x" }, { "X-Dashboard-Action": "knowledge-write" }), env })).status, 403);
  });
});

test("示唆の一覧は新しい順に制限付きページングで返す", async () => {
  let seen: URL | null = null;
  await withFetch((url) => {
    seen = url;
    return Response.json([row], { headers: { "Content-Range": "0-0/1" } });
  }, async () => {
    const response = await insightsRoute({ request: new Request("https://dashboard.example/api/insights?limit=1000&offset=0"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [row], total: 1, limit: 1000, offset: 0 });
    assert.equal(seen!.searchParams.get("order"), "created_at.desc,id.desc");
  });
});

test("示唆の編集は更新前の時刻で競合を検出する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    if (init?.method === "PATCH") return Response.json([]);
    return Response.json([{ id: 7 }]);
  }, async () => {
    const response = await insightItemRoute({
      request: request("/api/insights/7", "PATCH", { body: "新しい示唆", expected_updated_at: row.updated_at }),
      env,
      params: { id: "7" },
    });
    assert.equal(response.status, 409);
    const patch = requests.find((entry) => entry.init?.method === "PATCH");
    assert.equal(patch?.url.searchParams.get("updated_at"), `eq.${row.updated_at}`);
    assert.equal(JSON.parse(String(patch?.init?.body)).body, "新しい示唆");
  });
});

test("示唆を削除する", async () => {
  await withFetch((url, init) => {
    assert.equal(init?.method, "DELETE");
    assert.equal(url.searchParams.get("id"), "eq.7");
    return Response.json([{ id: 7 }]);
  }, async () => {
    const response = await insightItemRoute({ request: request("/api/insights/7", "DELETE"), env, params: { id: "7" } });
    assert.equal(response.status, 200);
    const invalid = await insightItemRoute({ request: request("/api/insights/abc", "DELETE"), env, params: { id: "abc" } });
    assert.equal(invalid.status, 400);
  });
});

test("AIのまとめは渡した示唆のIDだけを根拠として残す", () => {
  const themes = readThemes({
    themes: [
      { title: "相手に動いてもらう言い方", guiding_question: "角を立てずに頼むには？", summary: "要約", importance: "3つのナレッジに現れる", insight_ids: [1, 2, 99, 2] },
      { title: "根拠なし", summary: "要約", importance: "理由", insight_ids: [99] },
      { title: "", summary: "要約", importance: "理由", insight_ids: [1] },
    ],
  }, new Set([1, 2, 3]));
  assert.deepEqual(themes, [
    { title: "相手に動いてもらう言い方", guiding_question: "角を立てずに頼むには？", summary: "要約", importance: "3つのナレッジに現れる", insight_ids: [1, 2] },
  ]);
  // 問い文の下書きが欠けてもテーマは残し、保存時に書いてもらう
  assert.deepEqual(
    readThemes({ themes: [{ title: "t", summary: "s", importance: "i", insight_ids: [1] }] }, new Set([1]))?.[0].guiding_question,
    "",
  );
  assert.equal(readThemes({ themes: [] }, new Set([1])), null);
});

test("AIのまとめは示唆とナレッジ名だけを送り、結果を返す", async () => {
  let prompt = "";
  await withFetch(async (url, init) => {
    if (url.pathname.endsWith("/knowledge_insights")) {
      return Response.json([
        { id: 1, knowledge_id: knowledgeId, body: "依頼メールで使う" },
        { id: 2, knowledge_id: knowledgeId, body: "会議で断るときに使う" },
      ]);
    }
    if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId, title: "Would you mind ~ing", category: "英語" }]);
    if (url.hostname === "api.anthropic.com") {
      prompt = JSON.parse(String(init?.body)).messages[0].content;
      return Response.json({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "submit_insight_themes", input: { themes: [{ title: "角を立てずに頼む", summary: "s", importance: "i", insight_ids: [1, 2] }] } }],
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    const response = await analyzeRoute({ request: request("/api/insights/analyze", "POST"), env });
    assert.equal(response.status, 200);
    const body = await response.json() as { themes: Array<{ insight_ids: number[] }>; analyzed_count: number };
    assert.equal(body.analyzed_count, 2);
    assert.deepEqual(body.themes[0].insight_ids, [1, 2]);
    assert.match(prompt, /\[1\] Would you mind ~ing（英語）: 依頼メールで使う/);
  });
});

test("示唆は出題・採点のAPIやDB関数から参照しない", async () => {
  const quizFiles = [
    "../functions/api/quiz/start.ts",
    "../functions/api/quiz/grade.ts",
    "../functions/_shared/questionGeneration.ts",
    "../functions/_shared/answerGrading.ts",
    "../functions/_shared/reviewBatch.ts",
    "../functions/api/review-queue/answer.ts",
  ];
  for (const file of quizFiles) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /insight/i, file);
  }
  const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
  const sql = await readFile(new URL("../supabase/migrations/20260924100000_knowledge_insights.sql", import.meta.url), "utf8");
  assert.ok(migrations.includes("20260924100000_knowledge_insights.sql"));
  assert.match(sql, /references public\.knowledge\(id\) on delete cascade/);
  assert.match(sql, /revoke all on table public\.knowledge_insights from public, anon, authenticated;/);
});
