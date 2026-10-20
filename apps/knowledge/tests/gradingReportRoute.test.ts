import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/api/grading-report.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};
const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
const report = {
  knowledgeId,
  question: "部署ごとに分断された状態を何という？",
  userAnswer: "サイロ化",
  correctAnswer: "サイロ化",
  explanation: "正しく答えられています。",
  quality: 1,
  verdict: "不正解",
  comment: "合っているのに不正解になった",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/grading-report", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "grading-report",
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

test("問題・回答・採点結果を添えて、出典つきで未整理のInboxへ報告する", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  await withFetch((url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId, title: "サイロ化" }]);
    return Response.json([{ id: 300, created_at: "2026-10-18T01:00:00Z" }], { status: 201 });
  }, async () => {
    const response = await onRequest({ request: request(report), env });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 300, createdAt: "2026-10-18T01:00:00Z" });
    const insert = requests.find((entry) => entry.init?.method === "POST");
    assert.ok(insert);
    assert.equal(insert.url.pathname, "/rest/v1/idea_inbox");
    const body = JSON.parse(String(insert.init?.body)) as { content: string; status: string; source: string };
    assert.equal(body.status, "pending");
    assert.equal(body.source, "knowledge-grading-report");
    assert.equal(body.content.split("\n")[0], "採点がおかしい: サイロ化");
    for (const part of ["合っているのに不正解になった", "回答: サイロ化", "AIの採点: 不正解（q1）", `knowledge ${knowledgeId}`]) {
      assert.ok(body.content.includes(part), part);
    }
  });
});

test("存在しないナレッジの報告は登録しない", async () => {
  let inserted = false;
  await withFetch((_url, init) => {
    if (init?.method === "POST") inserted = true;
    return Response.json([]);
  }, async () => {
    assert.equal((await onRequest({ request: request(report), env })).status, 404);
    assert.equal(inserted, false);
  });
});

test("送信元・ヘッダー・入力を検証してからDBへ接続する", async () => {
  await withFetch(() => { throw new Error("should not fetch"); }, async () => {
    const status = async (body: unknown, headers: Record<string, string> = {}) =>
      (await onRequest({ request: request(body, headers), env })).status;
    assert.equal(await status(report, { Origin: "https://evil.example" }), 403);
    assert.equal(await status(report, { "X-Dashboard-Action": "inbox-deep-dive" }), 403);
    assert.equal(await status({ ...report, knowledgeId: "bad" }), 400);
    assert.equal(await status({ ...report, quality: 6 }), 400);
    assert.equal(await status({ ...report, verdict: "ふつう" }), 400);
    assert.equal(await status({ ...report, comment: "x".repeat(501) }), 400);
    assert.equal(await status({ ...report, source: "other" }), 400);
    const { comment: _comment, ...withoutComment } = report;
    assert.equal(await status(withoutComment), 400);
    assert.equal((await onRequest({ request: new Request("https://dashboard.example/api/grading-report"), env })).status, 405);
  });
});

test("学習ログと答え合わせの採点結果から報告できる", async () => {
  const parts = await readFile(new URL("../src/components/ReviewLogParts.tsx", import.meta.url), "utf8");
  assert.match(parts, /gradingReport && \(\s*<GradingReport/);
  const log = await readFile(new URL("../src/components/LearningLogView.tsx", import.meta.url), "utf8");
  assert.match(log, /gradingReport=\{\{/);
  const review = await readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8");
  assert.match(review, /gradingReport=\{result \? \{/);
  const component = await readFile(new URL("../src/components/GradingReport.tsx", import.meta.url), "utf8");
  assert.match(component, /reportGrading\(\{ \.\.\.report, comment \}\)/);
});
