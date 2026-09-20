import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as queueRoute } from "../functions/api/review/queue.ts";
import { onRequest as recoveryRoute } from "../functions/api/review/recovery.ts";
import { onRequest as quizStartRoute } from "../functions/api/quiz/start.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
  QUIZ_SIGNING_SECRET: "quiz-signing-secret-that-is-at-least-thirty-two-characters",
};

function mutationRequest(path: string, body: unknown, action: string) {
  return new Request(`https://dashboard.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
    },
    body: JSON.stringify(body),
  });
}

test("日次キュー状態は上限・進捗・期限超過総数を区別して返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rpc\/get_daily_review_status$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { p_limit: 15 });
    return Response.json([{
      review_on: "2026-09-20", queue_limit: 15, queue_total: 15,
      completed: 4, remaining: 11, due_total: 371, overdue_total: 318,
    }]);
  };
  try {
    const response = await queueRoute({ request: new Request("https://dashboard.example/api/review/queue?limit=15"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      review_on: "2026-09-20", limit: 15, total: 15, completed: 4,
      remaining: 11, due_total: 371, overdue_total: 318,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("今日のキューが完了済みならAIを呼ばず空状態を返す", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/rpc/pick_daily_review_queue")) return Response.json([]);
    if (url.endsWith("/rpc/get_daily_review_status")) {
      return Response.json([{ queue_total: 15, completed: 15, remaining: 0 }]);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const response = await quizStartRoute({
      request: mutationRequest("/api/quiz/start", {
        categories: [], limit: 15, format: "おまかせ", mode: "daily",
      }, "quiz-session"),
      env,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], reason: "done_today", mode: "daily" });
    assert.equal(seen.some((url) => url.includes("anthropic.com")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("回復モードは署名済みプレビューを確認した後だけ同じ配分を更新する", async () => {
  const originalFetch = globalThis.fetch;
  const assignments = [{
    knowledge_id: "123e4567-e89b-42d3-a456-426614174000",
    title: "Overdue knowledge",
    priority: "高",
    accuracy: 50,
    overdue_days: 30,
    current_next_review_on: "2026-08-21",
    scheduled_on: "2026-09-21",
    queue_position: 1,
  }];
  let appliedBody: unknown = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/rpc/preview_review_recovery")) return Response.json(assignments);
    if (url.endsWith("/rpc/apply_review_recovery")) {
      appliedBody = JSON.parse(String(init?.body));
      return Response.json(1);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const previewResponse = await recoveryRoute({
      request: mutationRequest("/api/review/recovery", { action: "preview", daily_limit: 15 }, "review-recovery"),
      env,
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { total: number; days: unknown[]; token: string };
    assert.equal(preview.total, 1);
    assert.equal(preview.days.length, 1);
    assert.ok(preview.token.length > 20);
    assert.equal(appliedBody, null);

    const applyResponse = await recoveryRoute({
      request: mutationRequest("/api/review/recovery", { action: "apply", token: preview.token }, "review-recovery"),
      env,
    });
    assert.equal(applyResponse.status, 200);
    assert.deepEqual(await applyResponse.json(), { updated: 1, daily_limit: 15 });
    assert.deepEqual(appliedBody, { p_assignments: [{
      knowledge_id: assignments[0].knowledge_id,
      current_next_review_on: assignments[0].current_next_review_on,
      scheduled_on: assignments[0].scheduled_on,
    }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DB migration fixes the queue for the day and ranks by priority, overdue days, accuracy, then id", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260920120000_daily_review_queue.sql", import.meta.url), "utf8");
  assert.match(sql, /daily_review_queue_items/);
  assert.match(sql, /if exists \(select 1 from public\.daily_review_queues where review_on = v_today\)/i);
  assert.match(sql, /case k\.priority when '最高' then 0/);
  assert.match(sql, /greatest\(v_today - coalesce\(k\.next_review_on, v_today\), 0\) desc/);
  assert.match(sql, /k\.accuracy asc nulls first/);
  assert.match(sql, /k\.id\s*\n/);
  assert.match(sql, /preview_review_recovery/);
  assert.match(sql, /recovery preview is stale/);
  assert.match(sql, /set next_review_on = a\.scheduled_on/);
});

test("日次キューと回復UIは主要件数、進捗、プレビュー、明示更新を表示する", async () => {
  const source = await readFile(new URL("../src/components/DailyReviewPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /今日の復習キュー/);
  assert.match(source, /期限超過/);
  assert.match(source, /回復プランをプレビュー/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /この配分で更新/);
});
