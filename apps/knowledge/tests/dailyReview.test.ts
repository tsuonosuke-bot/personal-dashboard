import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as queueRoute } from "../functions/api/review/queue.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
};

test("日次キュー状態は上限・進捗・期限超過総数を区別して返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rpc\/get_daily_review_status$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { p_limit: 15 });
    return Response.json([{
      review_on: "2026-09-20", queue_limit: 15, queue_total: 41,
      completed: 30, completed_unique: 24, remaining: 11, due_total: 11, overdue_total: 8,
      retry_ready: 2, retry_waiting: 3, next_retry_at: "2026-09-20T03:10:00Z",
      remaining_by_category: [
        { category: "英語", count: 7 },
        { category: "SAP", count: 4 },
        { category: "経済", count: 0 },
      ],
      new_limit: 10, new_held: 6,
    }]);
  };
  try {
    const response = await queueRoute({ request: new Request("https://dashboard.example/api/review/queue?limit=15"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      review_on: "2026-09-20", limit: 15, total: 41, completed: 30, completed_unique: 24,
      remaining: 11, due_total: 11, overdue_total: 8,
      retry_ready: 2, retry_waiting: 3, next_retry_at: "2026-09-20T03:10:00Z",
      remaining_by_category: [
        { category: "英語", count: 7 },
        { category: "SAP", count: 4 },
        { category: "経済", count: 0 },
      ],
      new_limit: 10, new_held: 6,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("カテゴリ別残数の合計が全体の残数と違う応答は拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    review_on: "2026-09-20", queue_limit: 15, queue_total: 11,
    completed: 0, completed_unique: 0, remaining: 11, due_total: 11, overdue_total: 8,
    retry_ready: 2, retry_waiting: 0, next_retry_at: null,
    remaining_by_category: [{ category: "英語", count: 10 }],
    new_limit: 10, new_held: 0,
  }]);
  try {
    const response = await queueRoute({
      request: new Request("https://dashboard.example/api/review/queue?limit=15"),
      env,
    });
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("旧日次キューの削除は旧スキル関数の削除後だけ進み、日次の状態集計は残す", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261004150000_drop_daily_review_queue.sql", import.meta.url),
    "utf8",
  );
  // 旧スキル（quiz-engine-v1）の関数が残っていれば、表を消す前に止める。
  assert.match(sql, /to_regprocedure\('public\.direct_quiz_pick\(text, text\[\], text\[\], integer\)'\) is not null/);
  assert.match(sql, /raise exception 'Apply 20261004130000_drop_quiz_engine_v1\.sql first/);
  assert.ok(sql.indexOf("raise exception") < sql.indexOf("drop table"));
  assert.match(sql, /drop function if exists public\.pick_daily_review_queue\(integer\);/);
  assert.match(sql, /drop function if exists public\.ensure_daily_review_queue\(integer\);/);
  assert.match(sql, /drop table if exists public\.daily_review_queue_items;/);
  assert.match(sql, /drop table if exists public\.daily_review_queues;/);
  // ダッシュボードの「今日の復習キュー」が使う日次の状態集計は消さない。
  assert.doesNotMatch(sql, /drop function[^;]*get_daily_review_status/);
  assert.doesNotMatch(sql, /drop function[^;]*daily_review_new_card_ids/);
});

test("continuous review makes 15 a batch size and gives every quality a distinct cadence", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260921100000_continuous_review_queue.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /next_review_at timestamptz/);
  assert.match(sql, /stability_hours numeric/);
  assert.match(sql, /when 0 then 10\.0 \/ 60/);
  assert.match(sql, /when 1 then 30\.0 \/ 60/);
  assert.match(sql, /when 2 then 6/);
  assert.match(sql, /else 12/);
  assert.match(sql, /v_stability \* 1\.40/);
  assert.match(sql, /v_stability \* 1\.80/);
  assert.match(sql, /p\.batch_limit - least\(5, c\.normal_count, p\.batch_limit\)/);
  assert.match(sql, /p_format = '四択'/);
  assert.match(sql, /v_was_early and p_quality >= 4/);
  assert.match(sql, /c\.completed \+ c\.remaining/);
  assert.match(sql, /attempt_id/);
});

test("カテゴリ別残数は全アクティブカテゴリを今すぐ復習可能な条件で集計する", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260921120000_daily_review_category_counts.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /where k\.archived = false\s+group by k\.category/);
  assert.match(sql, /count\(\*\) filter \(where k\.next_review_at <= now\(\)\)/);
  assert.match(sql, /coalesce\(sum\(c\.remaining\), 0\)/);
  assert.match(sql, /order by c\.remaining desc, c\.category/);
  assert.match(sql, /remaining_by_category jsonb/);
});

test("今日の学習は3つの数字に絞り、出題間隔の説明は折りたたみに置く", async () => {
  const source = await readFile(new URL("../src/components/TodayLearningPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /今日の学習/);
  // 問題数やカテゴリは選ばせず、キューの上から解き続ける
  assert.doesNotMatch(source, /カテゴリ・問題数を選ぶ|onCustomStart/);
  assert.match(source, /復習を始める（\$\{readyDue\}問）/);
  assert.match(source, /今すぐ解ける/);
  assert.match(source, /今日の回答/);
  assert.match(source, /見直す講評/);
  assert.match(source, /期限超過/);
  assert.match(source, /<details className="today-learning-how">/);
  assert.match(source, /途中で終えても大丈夫です/);
  assert.match(source, /q0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上/);
  assert.match(source, /最高0\.5・高1・中1\.5・低2・最低3倍/);
  assert.match(source, /新規は保留/);
  assert.match(source, /status\.new_held/);
  assert.match(source, /q4・q5は保持できた期間に応じて伸び/);
  assert.match(source, /再学習は最大10件/);
  assert.match(source, /categoryBreakdown/);
  assert.doesNotMatch(source, /この配分で更新/);
});

test("日次キュー状態に新規上限の項目がない応答は拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    review_on: "2026-09-28", queue_limit: 15, queue_total: 4,
    completed: 0, completed_unique: 0, remaining: 4, due_total: 4, overdue_total: 1,
    retry_ready: 0, retry_waiting: 0, next_retry_at: null,
    remaining_by_category: [{ category: "英語", count: 4 }],
  }]);
  try {
    const response = await queueRoute({
      request: new Request("https://dashboard.example/api/review/queue?limit=15"),
      env,
    });
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("復習ペースのマイグレーションは成長倍率・優先度倍率・新規上限をDB側に置く", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260928100000_review_pacing.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /when 4 then greatest\(48, case when v_stability <= 0 then 48 else v_stability \* 2\.00 end\)/);
  assert.match(sql, /else greatest\(96, case when v_stability <= 0 then 96 else v_stability \* 2\.80 end\)/);
  assert.match(sql, /when '最高' then 0\.5[\s\S]*when '中' then 1\.5[\s\S]*when '最低' then 3\.0/);
  // 優先度は予定だけに掛け、定着間隔そのものには掛けない
  assert.equal((sql.match(/v_due_hours := least\(8760, v_stability \* public\.review_priority_factor\(k\.priority\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /v_stability := [^;]*review_priority_factor/);
  assert.match(sql, /before update of priority on public\.knowledge/);
  assert.match(sql, /and new\.relearning_stage is null/);
  assert.match(sql, /as \$\$ select 10 \$\$/);
  assert.match(sql, /k\.id in \(select a\.id from allowed_new a\)/);
  assert.match(sql, /count\(\*\) filter \(where c\.is_due and not c\.is_held_new\)/);
  assert.match(sql, /new_limit integer,\s+new_held integer/);
  assert.match(sql, /c\.completed \+ c\.remaining/);
});

test("使われなくなった復習の配分見直し（recovery）のDB関数を削除する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261004110000_drop_review_recovery.sql", import.meta.url), "utf8");
  assert.match(sql, /drop function if exists public\.apply_review_recovery\(jsonb\);/);
  assert.match(sql, /drop function if exists public\.preview_review_recovery\(integer\);/);
});
