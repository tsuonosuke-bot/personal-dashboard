import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as masteryHistoryRoute } from "../functions/api/mastery-history.ts";
import { parseMasteryHistoryEvent } from "../src/lib/apiValidation.ts";
import { buildMasteryTrend } from "../src/lib/masteryTrend.ts";
import type { MasteryHistoryEvent } from "../src/types.ts";

const A = "123e4567-e89b-42d3-a456-426614174001";
const B = "123e4567-e89b-42d3-a456-426614174002";

function event(id: number, knowledgeId: string, mastery: MasteryHistoryEvent["to_mastery"], changedAt: string, baseline = false): MasteryHistoryEvent {
  return { id, knowledge_id: knowledgeId, to_mastery: mastery, is_baseline: baseline, changed_at: changedAt };
}

test("習得中・定着の件数を各日末の最新状態で数え、記録開始前はnullにする", () => {
  const events = [
    event(1, A, "学習中", "2026-09-20T01:00:00Z", true),
    event(2, B, "習得中", "2026-09-20T01:00:00Z", true),
    event(3, A, "習得中", "2026-09-21T02:00:00Z"),
    event(4, B, "定着", "2026-09-22T03:00:00Z"),
    event(5, A, "学習中", "2026-09-22T04:00:00Z"),
  ];
  const { points, trackingSince } = buildMasteryTrend(events, "day", new Date("2026-09-22T12:00:00Z"), 4);
  assert.equal(trackingSince, "2026-09-20");
  assert.deepEqual(points.map((p) => [p.key, p.learning, p.mastered]), [
    ["2026-09-19", null, null],
    ["2026-09-20", 1, 0],
    ["2026-09-21", 2, 0],
    ["2026-09-22", 0, 1],
  ]);
});

test("週単位では週末（今日まで）の状態を数える", () => {
  const events = [
    event(1, A, "習得中", "2026-09-14T01:00:00Z", true),
    event(2, A, "定着", "2026-09-22T01:00:00Z"),
  ];
  const { points } = buildMasteryTrend(events, "week", new Date("2026-09-22T12:00:00Z"), 2);
  assert.deepEqual(points.map((p) => [p.key, p.learning, p.mastered]), [
    ["2026-09-14", 1, 0],
    ["2026-09-21", 0, 1],
  ]);
});

test("履歴が無ければ推移を出さない", () => {
  const { points, trackingSince } = buildMasteryTrend([], "day", new Date("2026-09-22T12:00:00Z"), 3);
  assert.equal(trackingSince, null);
  assert.ok(points.every((p) => p.learning === null && p.mastered === null));
});

test("習熟度履歴の応答を検証する", () => {
  const row = event(1, A, "定着", "2026-09-22T01:00:00Z", true);
  assert.deepEqual(parseMasteryHistoryEvent(row), row);
  assert.throws(() => parseMasteryHistoryEvent({ ...row, to_mastery: "完璧" }), /to_mastery/);
  assert.throws(() => parseMasteryHistoryEvent({ ...row, is_baseline: "true" }), /is_baseline/);
});

test("mastery-history APIは明示した列を古い順に読み取り専用で返す", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  };
  try {
    const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
    const ok = await masteryHistoryRoute({
      request: new Request("https://dashboard.example/api/mastery-history?limit=100&offset=0"),
      env,
    });
    assert.equal(ok.status, 200);
    const url = decodeURIComponent(seenUrl);
    assert.match(url, /\/rest\/v1\/knowledge_mastery_history\?/);
    assert.match(url, /select=id,knowledge_id,to_mastery,is_baseline,changed_at/);
    assert.match(url, /order=changed_at.asc,id.asc/);
    const post = await masteryHistoryRoute({
      request: new Request("https://dashboard.example/api/mastery-history", { method: "POST" }),
      env,
    });
    assert.equal(post.status, 405);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("マイグレーションは習熟度の変化だけをSECURITY DEFINERのトリガーで記録する", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260923090000_knowledge_mastery_history.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /after insert or update of mastery on public\.knowledge/);
  assert.match(sql, /new\.mastery is distinct from old\.mastery/);
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on table public\.knowledge_mastery_history from public, anon, authenticated/);
  assert.match(sql, /is_baseline, changed_at\)\s+select k\.id, null, k\.mastery, true, now\(\)/);
});
