import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadConnectionStatus } from "../functions/_shared/connectionStatus.ts";
import { loadHub } from "../functions/_shared/hub.ts";
import { readReviewBatches } from "../functions/_shared/reviewBatches.ts";

const kind = { lastOkAt: "2026-10-05T11:50:00Z", lastRunAt: "2026-10-05T11:50:00Z", lastRunStatus: "succeeded", consecutiveFailures: 0, failed24h: 1, partial24h: 4, lastFailureAt: null, lastFailureNote: "AI応答の打ち切り" };
const batches = (alerts: unknown[] = []) => ({
  generate: kind,
  grade: { ...kind, failed24h: 0 },
  cron: [{ jobname: "review-grade-answers", schedule: "0 * * * *", active: true, lastRunAt: "2026-10-05T11:45:00Z", lastStatus: "succeeded", failed24h: 0, lastFailureMessage: null }],
  alerts,
});
const env = {
  SUPABASE_URL: "https://personal-db.example",
  SUPABASE_SECRET_KEY: "server-secret-key",
  HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
  NAV_KNOWLEDGE_URL: "https://knowledge.example/",
  NAV_FINANCIAL_URL: "https://finance.example/",
};

test("Knowledgeのバッチ状態は必要な項目だけ読み、形が違えばnullにする", () => {
  const read = readReviewBatches({ reviewBatches: batches([{ code: "grade_stale", message: "回答の採点のバッチが2時間以上成功していません。" }]) });
  assert.equal(read?.generate.partial24h, 4);
  assert.equal(read?.generate.failed24h, 1);
  assert.deepEqual(read?.alerts, ["回答の採点のバッチが2時間以上成功していません。"]);
  assert.equal(read?.cron[0].jobname, "review-grade-answers");
  assert.equal(readReviewBatches({ reviewBatches: null }), null);
  assert.equal(readReviewBatches({ migration: "x" }), null);
  assert.equal(readReviewBatches({ reviewBatches: { generate: kind } }), null);
});

test("接続状態はKnowledgeのバッチ状態を通し、Financeには付けない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.host === "personal-db.example") return Response.json([{ migration: "personal" }]);
    return Response.json({
      authMethod: "Basic認証 + 署名付きセッション", destination: url.host, migration: "m", lastSuccessAt: "2026-10-05T12:00:00Z",
      reviewBatches: batches(),
    });
  };
  try {
    const { services } = await loadConnectionStatus(env);
    assert.equal(services[1].reviewBatches?.generate.partial24h, 4);
    assert.equal("reviewBatches" in services[2], false);
    assert.equal("reviewBatches" in services[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hubのトップはバッチの警告を summary に載せ、取得できなければnullにする", async () => {
  const originalFetch = globalThis.fetch;
  const run = async (statusBody: unknown) => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.host === "knowledge.example" && url.pathname === "/api/status") return Response.json(statusBody);
      if (url.pathname === "/api/review-queue/status") return Response.json({ ready_due: 1, waiting_grading: 0, grading_errors: 0, unconfirmed_results: 0, generation_held: 0 });
      return url.host.endsWith(".example") && url.host !== "personal-db.example"
        ? Response.json({ items: [], total: 0, limit: 1000, offset: 0 })
        : Response.json([]);
    };
    return (await loadHub(env, new Date("2026-10-05T12:00:00Z"))).summary.reviewBatchAlerts;
  };
  try {
    assert.deepEqual(await run({ reviewBatches: batches([{ code: "generate_failing", message: "問題の生成のバッチが3回続けて失敗しています" }]) }), ["問題の生成のバッチが3回続けて失敗しています"]);
    assert.deepEqual(await run({ reviewBatches: batches() }), []);
    assert.equal(await run({ reviewBatches: null }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("トップのバナーはhub.jsが使うidをindex.htmlに持ち、警告が無ければ隠れている", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/hub.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="batchAlert"[^>]*role="alert"[^>]*hidden/);
  assert.match(html, /id="batchAlertList"/);
  assert.match(js, /renderAlerts\(summary\)/);
});
