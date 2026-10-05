import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as statusRoute } from "../functions/api/status.ts";
import { parseBatchHealth } from "../functions/_shared/reviewBatchHealth.ts";

const now = new Date("2026-10-05T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const kind = (overrides: Record<string, unknown> = {}) => ({
  last_ok_at: hoursAgo(0.2), last_run_at: hoursAgo(0.2), last_run_status: "succeeded",
  consecutive_failures: 0, failed_24h: 0, partial_24h: 0, last_failure_at: null, last_failure_note: null,
  ...overrides,
});
const cron = (jobname: string, overrides: Record<string, unknown> = {}) => ({
  jobname, schedule: "0 * * * *", active: true, last_run_at: hoursAgo(0.1), last_status: "succeeded",
  failed_24h: 0, last_failure_message: null, ...overrides,
});
const healthy = (overrides: Record<string, unknown> = {}) => ({
  generate: kind(), grade: kind(),
  cron: [cron("review-generate-questions"), cron("review-grade-answers")],
  ...overrides,
});

test("正常なバッチと一部のカードだけの失敗は警告にしない", () => {
  const health = parseBatchHealth(healthy({ generate: kind({ partial_24h: 5 }) }), now);
  assert.ok(health);
  assert.deepEqual(health.alerts, []);
  assert.equal(health.generate.partial24h, 5);
  assert.equal(health.generate.failed24h, 0);
});

test("バッチ全体の失敗が3回続いたら警告し、直近の失敗理由を添える", () => {
  const health = parseBatchHealth(healthy({
    generate: kind({ consecutive_failures: 3, failed_24h: 3, last_failure_note: "AI応答の打ち切り" }),
  }), now);
  assert.deepEqual(health?.alerts.map((a) => a.code), ["generate_failing"]);
  assert.match(health!.alerts[0].message, /3回続けて失敗.*AI応答の打ち切り/);
  assert.equal(parseBatchHealth(healthy({ grade: kind({ consecutive_failures: 2 }) }), now)?.alerts.length, 0);
});

test("最後の成功から生成3時間・採点3時間以上空くと警告する", () => {
  const stale = parseBatchHealth(healthy({
    generate: kind({ last_ok_at: hoursAgo(3.5) }),
    grade: kind({ last_ok_at: hoursAgo(2.9) }),
  }), now);
  assert.deepEqual(stale?.alerts.map((a) => a.code), ["generate_stale"]);
  const noRecord = parseBatchHealth(healthy({ grade: kind({ last_ok_at: null }) }), now);
  assert.deepEqual(noRecord?.alerts.map((a) => a.code), ["grade_stale"]);
});

test("pg_cronのジョブが無い・止まっている・失敗している・動いていないときに警告する", () => {
  const codes = (jobs: unknown[]) => parseBatchHealth(healthy({ cron: jobs }), now)?.alerts.map((a) => a.code);
  assert.deepEqual(codes([cron("review-grade-answers")]), ["cron_missing"]);
  assert.deepEqual(codes([cron("review-generate-questions", { active: false }), cron("review-grade-answers")]), ["cron_missing"]);
  assert.deepEqual(
    codes([cron("review-generate-questions", { last_status: "failed", last_failure_message: "job startup timeout" }), cron("review-grade-answers")]),
    ["cron_failing"],
  );
  assert.deepEqual(codes([cron("review-generate-questions", { last_run_at: hoursAgo(2.5) }), cron("review-grade-answers")]), ["cron_stale"]);
  // 採点は1時間ごとなので、2.5時間空いていてもまだ警告しない。
  assert.deepEqual(codes([cron("review-generate-questions"), cron("review-grade-answers", { last_run_at: hoursAgo(2.5) })]), []);
  assert.deepEqual(codes([cron("review-generate-questions"), cron("review-grade-answers", { last_run_at: hoursAgo(3.5) })]), ["cron_stale"]);
  // 24時間内に失敗があっても、直近が成功なら警告しない。
  assert.deepEqual(codes([cron("review-generate-questions", { failed_24h: 1 }), cron("review-grade-answers")]), []);
});

test("形が違う応答はnullにする", () => {
  assert.equal(parseBatchHealth(null, now), null);
  assert.equal(parseBatchHealth([{ migration: "x" }], now), null);
  assert.equal(parseBatchHealth({ generate: kind() }, now), null);
});

test("/api/status は reviewBatches を返し、DB関数が失敗してもnullで応答する", async () => {
  const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => String(input).endsWith("/rpc/get_review_batch_health")
      ? Response.json(healthy())
      : Response.json([{ migration: "20261005100000_review_batch_health" }]);
    const ok = await (await statusRoute({ request: new Request("https://dashboard.example/api/status"), env })).json() as {
      reviewBatches: { generate: { lastOkAt: string }; alerts: unknown[] } | null;
    };
    assert.ok(ok.reviewBatches?.generate.lastOkAt);
    assert.ok(Array.isArray(ok.reviewBatches?.alerts));

    globalThis.fetch = async (input) => String(input).endsWith("/rpc/get_review_batch_health")
      ? Response.json({ message: "function not found" }, { status: 404 })
      : Response.json([{ migration: "20261004120000_review_generation_holds" }]);
    const response = await statusRoute({ request: new Request("https://dashboard.example/api/status"), env });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { reviewBatches: unknown }).reviewBatches, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("健康状態の関数は読み取り専用で、service_roleだけが実行できる", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261005100000_review_batch_health.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on function public\.get_review_batch_health\(\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.get_review_batch_health\(\) to service_role;/);
  assert.doesNotMatch(sql, /\b(insert into public\.review|update public\.review|delete from)/);
});
