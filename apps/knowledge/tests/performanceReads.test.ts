import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as logRoute } from "../../hub/functions/knowledge/api/learning-log.ts";
import { onRequest as stateRoute } from "../../hub/functions/knowledge/api/learning-log/confirmation-state.ts";
import { onRequest as masteryRoute } from "../../hub/functions/knowledge/api/mastery-history.ts";
import { onRequest as memberRoute } from "../../hub/functions/knowledge/api/insight-group-members/batch.ts";
import { onRequest as hubRoute } from "../../hub/functions/knowledge/api/hub-summary.ts";
import { onRequest as gradeRoute } from "../../hub/functions/knowledge/api/review-batch/grade.ts";
import { getLearningLogPage, getReviewConfirmationState, learningQuery, parseLearningSummary, snapshotReviewResultIds } from "../src/lib/learningReadApi.ts";
import { createReviewConfirmationCoordinator } from "../src/lib/reviewConfirmation.ts";
import { knowledgeMasteryChanges } from "../src/lib/knowledgeReviewHistory.ts";
import { filterKnowledge } from "../src/lib/knowledge.ts";
import { DEFAULT_FILTERS } from "../src/lib/listState.ts";
import type { Knowledge, MasteryHistoryEvent } from "../src/types.ts";

const K1 = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-10-26T01:00:00Z";
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "test-secret", ANTHROPIC_API_KEY: "test-ai" };
const request = (path: string) => new Request(`https://knowledge.example${path}`);
const log = (id: number) => ({ id, knowledge_id: K1, asked_on: "2026-10-26", created_at: stamp, answered_at: stamp,
  quality: 1, verdict: "不正解", format: "一問一答", note: null, question: "question", user_answer: "answer",
  correct_answer: "correct", explanation: "feedback", confirmed_at: null, review_queue_id: id,
  title: "カード", category: "技術" });

test("履歴は検索条件をDBへ渡して30件だけ取得し、IDスナップショットは本文を要求しない", async () => {
  const original = globalThis.fetch;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const name = new URL(String(input)).pathname.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)); calls.push({ name, body });
    return Response.json(name === "snapshot_review_result_ids" ? Array.from({ length: 1098 }, (_, i) => i + 1)
      : { items: Array.from({ length: 30 }, (_, i) => log(i + 1)), total: 1098, correct: 0, unconfirmed: 1098, limit: 30, offset: 0 });
  };
  try {
    const response = await logRoute({ env, request: request("/api/learning-log?from=2026-10-20&category=技術&verdict=不正解&unconfirmed=true&limit=30&offset=0") });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { items: unknown[] }).items.length, 30);
    assert.deepEqual(calls[0], { name: "get_learning_log_page", body: { p_from: "2026-10-20", p_category: "技術", p_verdict: "不正解", p_unconfirmed: true,
      p_knowledge_id: null, p_misses: false, p_ids: null, p_limit: 30, p_offset: 0 } });
    const snapshot = await logRoute({ env, request: request("/api/learning-log?from=2026-10-20&category=技術&verdict=不正解&ids=true") });
    assert.equal((await snapshot.json() as unknown[]).length, 1098);
    assert.equal(calls[1].name, "snapshot_review_result_ids");
    assert.deepEqual(Object.keys(calls[1].body).sort(), ["p_category", "p_from", "p_misses", "p_verdict"]);
    for (const query of ["from=2026-02-30", "knowledge_id=bad", "verdict=unknown", "limit=201", "unconfirmed=maybe", "result_ids=1,-2"]) {
      assert.equal((await logRoute({ env, request: request(`/api/learning-log?${query}`) })).status, 400);
    }
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("30件表示から1098件の固定対象を確認し、部分失敗後は対象IDだけ照合して残りだけ再送する", async () => {
  const states = new Map(Array.from({ length: 1098 }, (_, i) => [i + 1, { id: i + 1, review_queue_id: i + 1, confirmed_at: null as string | null }]));
  const original = globalThis.fetch;
  let bodyRequests = 0, snapshotRequests = 0, stateRequests = 0, fail = true;
  const posted: number[][] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://knowledge.example");
    if (url.pathname === "/api/learning-log/confirmation-state") {
      stateRequests++;
      const ids = url.searchParams.get("ids")!.split(",").map(Number);
      assert.ok(ids.length <= 200);
      return Response.json(ids.flatMap((id) => states.get(id) ?? []));
    }
    assert.equal(url.pathname, "/api/learning-log");
    if (url.searchParams.get("ids") === "true") { snapshotRequests++; return Response.json([...states.keys()]); }
    bodyRequests++;
    return Response.json({ items: Array.from({ length: 30 }, (_, i) => log(i + 1)), total: 1098, correct: 0, unconfirmed: 1098, limit: 30, offset: 0 });
  };
  try {
    const query = learningQuery({ period: "7", category: "技術", verdict: "不正解" }, "2026-10-26");
    assert.equal((await getLearningLogPage(query, 30, 0)).items.length, 30);
    const ids = await snapshotReviewResultIds(query);
    const coordinator = createReviewConfirmationCoordinator({
      confirm: async (chunk) => {
        posted.push(chunk);
        if (posted.length === 3 && fail) { fail = false; throw new Error("timeout"); }
        for (const id of chunk) states.get(id)!.confirmed_at = stamp;
        return { confirmed: chunk.length, confirmedIds: chunk };
      }, reload: async (targets) => ({ ok: true, quizLog: await getReviewConfirmationState(targets) }),
    });
    const partial = await coordinator.run(ids);
    assert.equal(partial?.confirmedIds.length, 400);
    assert.equal(partial?.remainingIds.length, 698);
    states.set(2000, { id: 2000, review_queue_id: 2000, confirmed_at: null });
    const done = await coordinator.run(ids, { previous: partial! });
    assert.equal(done?.verified, true);
    assert.equal(done?.confirmedIds.length, 1098);
    assert.deepEqual(done?.remainingIds, []);
    assert.deepEqual(posted.map((chunk) => chunk.length), [200, 200, 200, 200, 200, 200, 98]);
    assert.equal(states.get(2000)!.confirmed_at, null);
    assert.equal(bodyRequests, 1); assert.equal(snapshotRequests, 1); assert.equal(stateRequests, 18);
  } finally { globalThis.fetch = original; }
});

test("確認状態のDB上限・取得失敗を削除済みや完了へ置き換えない", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ id: 1, review_queue_id: 1, confirmed_at: stamp }], { headers: { "Content-Range": "0-0/2" } });
  try { assert.equal((await stateRoute({ env, request: request("/api/learning-log/confirmation-state?ids=1,2") })).status, 502); }
  finally { globalThis.fetch = original; }
});

test("1カードの習熟度は10件と直前1件だけをDBで絞り、ページ末尾の変更前値を保つ", async () => {
  const original = globalThis.fetch;
  let url: URL | null = null;
  const rows: MasteryHistoryEvent[] = Array.from({ length: 11 }, (_, i) => ({ id: 31 - i, knowledge_id: K1,
    to_mastery: i % 2 ? "学習中" : "習得中", is_baseline: false, changed_at: stamp }));
  globalThis.fetch = async (input) => { url = new URL(String(input)); return Response.json(rows, { headers: { "Content-Range": "10-20/31" } }); };
  try {
    const response = await masteryRoute({ env, request: request(`/api/mastery-history?knowledge_id=${K1}&limit=10&offset=10`) });
    const page = await response.json() as { items: MasteryHistoryEvent[]; previous: MasteryHistoryEvent; total: number };
    assert.equal(page.items.length, 10); assert.equal(page.total, 31); assert.equal(page.previous.id, 21);
    assert.equal(url!.searchParams.get("knowledge_id"), `eq.${K1}`);
    assert.equal(url!.searchParams.get("limit"), "11");
    const changes = knowledgeMasteryChanges([...page.items, page.previous], K1).filter((row) => row.id !== page.previous.id);
    assert.equal(changes.at(-1)!.from_mastery, page.previous.to_mastery);
    assert.equal((await masteryRoute({ env, request: request("/api/mastery-history?knowledge_id=bad&limit=10") })).status, 400);
  } finally { globalThis.fetch = original; }
});

test("20件の所属追加は1RPCでupdated_at競合と部分失敗を返し、不正要求はDBへ送らない", async () => {
  const original = globalThis.fetch;
  let calls = 0, conflict = false;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_expected_updated_at, stamp); assert.equal(body.p_insight_ids.length, 20);
    return Response.json(conflict ? { group: { id: 1 }, conflict: true } : {
      group: { id: 1, updated_at: "2026-10-26T01:00:01Z" }, members: body.p_insight_ids.slice(0, 19).map((id: number) => ({ group_id: 1, insight_id: id })), failedIds: [20],
    });
  };
  const input = (patch = {}) => new Request("https://knowledge.example/api/insight-group-members/batch", { method: "POST",
    headers: { Origin: "https://knowledge.example", "Content-Type": "application/json", "X-Dashboard-Action": "knowledge-insight-group" },
    body: JSON.stringify({ group_id: 1, insight_ids: Array.from({ length: 20 }, (_, i) => i + 1), expected_updated_at: stamp, ...patch }) });
  try {
    const result = await memberRoute({ env, request: input() });
    assert.equal(result.status, 200); assert.deepEqual((await result.json() as { failedIds: number[] }).failedIds, [20]); assert.equal(calls, 1);
    conflict = true; assert.equal((await memberRoute({ env, request: input() })).status, 409);
    assert.equal((await memberRoute({ env, request: input({ expected_updated_at: null }) })).status, 400); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("JSTの午前0時と異なるoffsetの期限を同じ時刻範囲で比較する", () => {
  const rows = ["2026-10-25T14:59:59.999Z", "2026-10-25T15:00:00Z", "2026-10-26T08:00:00-05:00", "2026-10-26T15:00:00Z"]
    .map((next_review_at, i) => ({ id: String(i), next_review_at })) as Knowledge[];
  assert.deepEqual(filterKnowledge(rows, { ...DEFAULT_FILTERS, review: "today" }, "2026-10-26").map((row) => row.id), ["1", "2"]);
  assert.deepEqual(filterKnowledge(rows, { ...DEFAULT_FILTERS, review: "today" }, "2026-10-27").map((row) => row.id), ["3"]);
  assert.deepEqual(filterKnowledge(rows, { ...DEFAULT_FILTERS, review: "due" }, "2026-10-26", new Date("2026-10-25T15:00:00Z")).map((row) => row.id), ["0", "1"]);
});

test("Hub summaryは1つの集約RPCを読み、存在しない日付をDBへ渡さない", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input, init) => { calls++; assert.match(String(input), /rpc\/get_knowledge_hub_summary$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { p_today: "2026-10-26" });
    return Response.json({ dueCount: 2, weakCount: 3, items: [], reviewStatus: {} }); };
  try {
    assert.equal((await hubRoute({ env, request: request("/api/hub-summary?today=2026-10-26") })).status, 200);
    assert.equal((await hubRoute({ env, request: request("/api/hub-summary?today=2026-02-30") })).status, 400); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("30回答の保存は1HTTP往復で、遅い後続生成より先に採点応答を返しサーバーで継続する", async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let claimed = false, saved = false, generationClaimed = false, generationFinished = false;
  let saveRequests = 0, aiCalls = 0;
  const work: Promise<unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.anthropic.com") { aiCalls++; throw new Error("AI is unnecessary for multiple choice"); }
    if (url.pathname === "/rest/v1/knowledge") return Response.json(Array.from({ length: 30 }, (_, i) => ({ id: `card-${i}`, title: "B", explanation: null, category: "技術", tags: [], archived: false })));
    const name = url.pathname.split("/").at(-1), body = JSON.parse(String(init?.body));
    if (name === "begin_review_batch") return Response.json(1);
    if (name === "list_pending_review_ai_batches") return Response.json([]);
    if (name === "claim_review_answers") {
      if (claimed) return Response.json([]); claimed = true;
      return Response.json(Array.from({ length: 30 }, (_, i) => ({ id: i + 1, knowledge_id: `card-${i}`, format: "四択", question: "Q", choices: ["A", "B", "C", "D"], correct_choice: "B", prepared_explanation: "Bです", answer_text: "A" })));
    }
    if (name === "record_review_grades_batch") {
      saveRequests++; assert.equal(body.p_grades.length, 30); saved = true;
      return Response.json(body.p_grades.map((grade: { item_id: number }) => ({ item_id: grade.item_id, recorded: true, status: "graded", relearning: true, error: null })));
    }
    if (name === "claim_relearning_generation") { assert.equal(saved, true); if (generationClaimed) return Response.json(null); generationClaimed = true; return Response.json(2); }
    if (name === "attach_review_generation_jobs") return Response.json(null);
    if (name === "get_review_queue_status") { await gate; return Response.json([{ ready_total: 200, queue_limit: 200, queue_full: true }]); }
    if (name === "finish_review_batch") return Response.json(null);
    if (name === "finish_review_generation_jobs") { generationFinished = true; return Response.json(null); }
    throw new Error(`unexpected ${name}`);
  };
  const gradeRequest = () => new Request("https://knowledge.example/knowledge/api/review-batch/grade", { method: "POST",
    headers: { Origin: "https://knowledge.example", "Content-Type": "application/json", "X-Dashboard-Action": "review-queue" }, body: "{}" });
  try {
    const response = await Promise.race([gradeRoute({ env, request: gradeRequest(), waitUntil: (promise) => work.push(promise) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("grade response waited for generation")), 500))]);
    assert.equal(response.status, 200); assert.equal((await response.json() as { succeeded: number }).succeeded, 30);
    assert.equal(saveRequests, 1); assert.equal(work.length, 1); assert.equal(generationFinished, false);
    // This second server request sees the running durable job, even without a client continuation.
    assert.equal((await gradeRoute({ env, request: gradeRequest(), waitUntil: (promise) => work.push(promise) })).status, 200);
    assert.equal(work.length, 1); assert.equal(saveRequests, 1);
    release(); await Promise.all(work); assert.equal(generationFinished, true); assert.equal(aiCalls, 0);
  } finally { release(); await Promise.all(work); globalThis.fetch = original; }
});

test("壊れた集計を部分的な成功値として描画しない", () => {
  assert.throws(() => parseLearningSummary({ date: "2026-10-26", today: { answered: -1 } }));
});
