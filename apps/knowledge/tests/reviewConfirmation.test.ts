import assert from "node:assert/strict";
import test from "node:test";
import { confirmReviewResultsDetailed, getQuizLog } from "../src/lib/api.ts";
import { parseReviewConfirmation } from "../src/lib/apiValidation.ts";
import { buildLearningLog } from "../src/lib/learningLog.ts";
import {
  createReviewConfirmationCoordinator, unconfirmedResultIds, type ConfirmationProgress,
} from "../src/lib/reviewConfirmation.ts";
import { onRequest as confirmRoute } from "../../hub/functions/knowledge/api/review-queue/confirm.ts";
import type { Knowledge, QuizLog } from "../src/types.ts";

const STAMP = "2026-10-23T03:00:00Z";
const row = (id: number, patch: Partial<QuizLog> = {}): QuizLog => ({
  id, knowledge_id: "a", asked_on: "2026-10-23", quality: 1, verdict: "不正解", format: "一問一答",
  note: null, created_at: STAMP, question: "問題", user_answer: "回答", correct_answer: "想定解",
  explanation: "講評", answered_at: STAMP, confirmed_at: null, review_queue_id: id + 10000, ...patch,
});
const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i + 1));
const idsOf = (logs: QuizLog[]) => logs.map((item) => item.id);
const mark = (logs: QuizLog[], ids: number[]) => {
  for (const log of logs) if (ids.includes(log.id) && log.review_queue_id !== null && log.confirmed_at === null) log.confirmed_at = STAMP;
};
const browserRequest = (ids: unknown, headers: Record<string, string> = {}) => new Request("https://dashboard.example/api/review-queue/confirm", {
  method: "POST",
  headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "review-queue", ...headers },
  body: JSON.stringify({ quiz_log_ids: ids }),
});
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };

test("30件の表示とは独立して、検索条件に一致する未確認1098件を200×5+98で全件確認する", async () => {
  const knowledge = [{ id: "a", title: "対象", category: "技術" }, { id: "b", title: "条件外", category: "英語" }] as Knowledge[];
  const logs = [...rows(1098), row(2001, { knowledge_id: "b" }), row(2002, { asked_on: "2026-09-01" }),
    row(2003, { verdict: "正解" }), row(2004, { confirmed_at: STAMP }), row(2005, { review_queue_id: null })];
  const before = structuredClone(logs);
  const entries = buildLearningLog(logs, knowledge, { period: "7", category: "技術", verdict: "不正解" }, "2026-10-23");
  assert.equal(entries.slice(0, 30).length, 30);
  const target = unconfirmedResultIds(entries);
  assert.equal(target.length, 1098);
  const calls: number[][] = [];
  const progress: ConfirmationProgress[] = [];
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async (ids) => { calls.push(ids); mark(logs, ids); return { confirmed: ids.length, confirmedIds: ids }; },
    reload: async () => ({ ok: true, quizLog: logs }), onProgress: (value) => progress.push(value),
  });
  const result = await coordinator.run(target);
  assert.deepEqual(calls.map((ids) => ids.length), [200, 200, 200, 200, 200, 98]);
  assert.equal(new Set(calls.flat()).size, 1098);
  assert.deepEqual(new Set(calls.flat()), new Set(target));
  assert.equal(result?.verified, true);
  assert.equal(result?.confirmedIds.length, 1098);
  assert.deepEqual(result?.remainingIds, []);
  assert.deepEqual(progress.filter((value) => value.phase === "confirming").map((value) => value.confirmedIds.length),
    [0, 200, 200, 400, 400, 600, 600, 800, 800, 1000, 1000, 1098]);
  assert.deepEqual(logs.slice(1098), before.slice(1098));
  assert.deepEqual(logs.map(({ confirmed_at: _confirmedAt, ...other }) => other),
    before.map(({ confirmed_at: _confirmedAt, ...other }) => other));
});

test("期間・JST日付・カテゴリ・判定・確認状態が検索結果と同じ集合になる", () => {
  const logs = [row(1, { asked_on: "2026-10-17", created_at: "2026-10-16T15:00:00Z" }),
    row(2, { asked_on: "2026-10-16", created_at: "2026-10-16T14:59:59Z" }),
    row(3, { knowledge_id: "b", verdict: "部分正解" }), row(4, { confirmed_at: STAMP }),
    row(5, { review_queue_id: null }), row(6, { verdict: "正解", confirmed_at: STAMP })];
  const knowledge = [{ id: "a", title: "A", category: "技術" }, { id: "b", title: "B", category: "英語" }] as Knowledge[];
  for (const period of ["7", "30", "90", "all"] as const) for (const category of ["all", "技術", "英語"]) {
    for (const verdict of ["all", "正解", "部分正解", "不正解"] as const) {
      const entries = buildLearningLog(logs, knowledge, { period, category, verdict }, "2026-10-23");
      const expected = entries.filter((entry) => entry.review_queue_id !== null && entry.confirmed_at === null).map((entry) => entry.id);
      assert.deepEqual(unconfirmedResultIds(entries), expected);
      assert.deepEqual(unconfirmedResultIds(entries.filter((entry) => entry.review_queue_id !== null && entry.confirmed_at === null)), expected);
    }
  }
  assert.deepEqual(unconfirmedResultIds(buildLearningLog(logs, knowledge,
    { period: "7", category: "技術", verdict: "all" }, "2026-10-23")), [1]);
  assert.deepEqual(unconfirmedResultIds([row(1), row(1), row(2)], new Set([2])), [1]);
});

test("200件境界・空集合・入力重複を処理し、固定集合へ実行中の新しい採点を加えない", async () => {
  for (const count of [0, 1, 199, 200, 201, 400]) {
    const logs = rows(count);
    const input = idsOf(logs);
    const calls: number[][] = [];
    const coordinator = createReviewConfirmationCoordinator({
      confirm: async (ids) => {
        calls.push(ids); mark(logs, ids);
        // 元配列とサーバーログが実行中に増えても、対象は固定済み。
        input.push(9000 + calls.length); logs.push(row(9000 + calls.length));
        return { confirmed: ids.length, confirmedIds: ids };
      },
      reload: async () => ({ ok: true, quizLog: logs }),
    });
    const result = await coordinator.run(input.length ? [...input, input[0]] : []);
    assert.equal(result?.targetIds.length, count);
    assert.equal(calls.flat().length, count);
    assert.ok(calls.every((ids) => ids.length <= 200));
    assert.ok(calls.flat().every((id) => id <= count));
  }
});

test("2チャンク成功後の失敗は400件を反映し、最新状態を再取得して残り698件だけ再実行する", async () => {
  const logs = rows(1098);
  const calls: number[][] = [];
  const applied: number[] = [];
  let fail = true;
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async (ids) => {
      calls.push(ids);
      if (fail && calls.length === 3) throw new Error("通信失敗");
      mark(logs, ids); return { confirmed: ids.length, confirmedIds: ids };
    },
    reload: async () => ({ ok: true, quizLog: logs }),
    onConfirmed: (ids) => applied.push(...ids),
  });
  const first = await coordinator.run(idsOf(logs));
  assert.equal(first?.confirmedIds.length, 400);
  assert.equal(first?.remainingIds.length, 698);
  assert.equal(first?.verified, true);
  assert.equal(new Set(applied).size, 400);
  fail = false;
  const second = await coordinator.run(first!.targetIds, { previous: first! });
  assert.deepEqual(calls.slice(3).map((ids) => ids.length), [200, 200, 200, 98]);
  assert.equal(second?.confirmedIds.length, 1098);
  assert.deepEqual(second?.remainingIds, []);
  assert.equal(second?.error, null);
});

test("応答前タイムアウトと他画面の同時確認は件数0でもDBの状態で解決する", async () => {
  const logs = rows(201);
  let calls = 0;
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async (ids) => {
      calls++; mark(logs, ids);
      if (calls === 1) throw new Error("応答前タイムアウト");
      return { confirmed: 0, confirmedIds: ids }; // 他画面が先に確認済みにしたケース
    },
    reload: async () => ({ ok: true, quizLog: logs }),
  });
  const first = await coordinator.run(idsOf(logs));
  assert.equal(first?.confirmedIds.length, 200);
  assert.deepEqual(first?.remainingIds, [201]);
  mark(logs, [201]);
  const second = await coordinator.run(first!.targetIds, { previous: first! });
  assert.equal(calls, 1); // 再取得で全件確認済みと分かり、再送しない
  assert.equal(second?.verified, true);
  assert.deepEqual(second?.remainingIds, []);
});

test("全件再取得の失敗は完了にせず、成功分を保持し再読込に成功するまで再送しない", async () => {
  const logs = rows(201);
  let reloadOk = false;
  let calls = 0;
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async (ids) => { calls++; mark(logs, ids); return { confirmed: ids.length, confirmedIds: ids }; },
    reload: async () => reloadOk ? { ok: true, quizLog: logs } : { ok: false, error: "全ページ取得失敗" },
  });
  const first = await coordinator.run(idsOf(logs));
  assert.equal(first?.verified, false);
  assert.equal(first?.confirmedIds.length, 201);
  assert.match(first?.error ?? "", /全ページ取得失敗/);
  const second = await coordinator.run(first!.targetIds, { previous: first! });
  assert.equal(second?.verified, false);
  assert.equal(calls, 2);
  reloadOk = true;
  const third = await coordinator.run(first!.targetIds, { previous: second!, recheckOnly: true });
  assert.equal(calls, 2);
  assert.equal(third?.verified, true);
  assert.deepEqual(third?.remainingIds, []);
});

test("再取得の例外も未完了として扱い、同期ロックを必ず解放する", async () => {
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async () => ({ confirmed: 0, confirmedIds: [] }),
    reload: async () => { throw new Error("切断"); },
  });
  const result = await coordinator.run([1]);
  assert.equal(result?.verified, false);
  assert.match(result?.error ?? "", /切断/);
  assert.equal(coordinator.busy, false);
});

test("二重クリックと単票確認は送信中・最終再取得中とも共有する同期ロックで防ぐ", async () => {
  const logs = rows(1);
  let finishSend!: () => void;
  let finishReload!: () => void;
  let reloadStarted!: () => void;
  const sent = new Promise<void>((resolve) => { finishSend = resolve; });
  const reloaded = new Promise<void>((resolve) => { finishReload = resolve; });
  const started = new Promise<void>((resolve) => { reloadStarted = resolve; });
  let calls = 0;
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async (ids) => { calls++; await sent; mark(logs, ids); return { confirmed: 1, confirmedIds: ids }; },
    reload: async () => { reloadStarted(); await reloaded; return { ok: true, quizLog: logs }; },
  });
  const first = coordinator.run([1]);
  assert.equal(coordinator.busy, true);
  assert.equal(await coordinator.run([1]), null);
  assert.equal(await coordinator.run([2]), null);
  finishSend(); await started;
  assert.equal(await coordinator.run([1]), null);
  finishReload(); await first;
  assert.equal(calls, 1);
  assert.equal(coordinator.busy, false);
});

test("未存在・対象外は確認済みとせず分け、残る未確認は完了としない", async () => {
  const logs = [row(1, { confirmed_at: STAMP }), row(3, { review_queue_id: null }), row(4)];
  const coordinator = createReviewConfirmationCoordinator({
    confirm: async () => ({ confirmed: 0, confirmedIds: [1] }),
    reload: async () => ({ ok: true, quizLog: logs }),
  });
  const result = await coordinator.run([1, 2, 3, 4]);
  assert.deepEqual(result?.confirmedIds, [1]);
  assert.deepEqual(result?.excludedIds, [2, 3]);
  assert.deepEqual(result?.remainingIds, [4]);
  assert.equal(result?.verified, true);
});

test("確認詳細のclientは件数0の確認済みIDを受け入れ、不正・欠落・対象外IDを拒否する", async () => {
  assert.deepEqual(parseReviewConfirmation({ confirmed: 0, confirmedIds: [1, 2] }, [1, 2]), { confirmed: 0, confirmedIds: [1, 2] });
  for (const data of [null, {}, { confirmed: 1 }, { confirmed: "1", confirmedIds: [1] },
    { confirmed: -1, confirmedIds: [] }, { confirmed: 1.1, confirmedIds: [] }, { confirmed: 3, confirmedIds: [] },
    { confirmed: 0, confirmedIds: [1, 1] }, { confirmed: 0, confirmedIds: [3] }, { confirmed: 0, confirmedIds: ["1"] }]) {
    assert.throws(() => parseReviewConfirmation(data, [1, 2]), /確認結果/);
  }
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { quiz_log_ids: [1, 2] });
    return Response.json({ confirmed: 0, confirmedIds: [1, 2] });
  };
  try { assert.deepEqual(await confirmReviewResultsDetailed([1, 2, 1]), { confirmed: 0, confirmedIds: [1, 2] }); }
  finally { globalThis.fetch = original; }
});

test("APIはRPC後のDBを読み、並行確認・削除・対象外を偽らず返す（確認以外の列は変更しない）", async () => {
  const logs = [row(1), row(2, { confirmed_at: STAMP }), row(3, { review_queue_id: null })];
  const before = structuredClone(logs);
  const original = globalThis.fetch;
  const calls: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    if (url.pathname.endsWith("/rpc/confirm_review_results")) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { p_quiz_log_ids: [1, 2, 3, 4] });
      mark(logs, [1, 2, 3, 4]); return Response.json(1);
    }
    assert.equal(init?.method, "GET");
    assert.equal(url.pathname, "/rest/v1/quiz_log");
    assert.equal(url.searchParams.get("select"), "id,confirmed_at,review_queue_id");
    assert.equal(url.searchParams.get("id"), "in.(1,2,3,4)");
    assert.equal(url.searchParams.get("limit"), "200");
    return Response.json(logs.map(({ id, confirmed_at, review_queue_id }) => ({ id, confirmed_at, review_queue_id })));
  };
  try {
    const response = await confirmRoute({ request: browserRequest([1, 2, 3, 4, 1]), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { confirmed: 1, confirmedIds: [1, 2] });
    assert.equal(calls.length, 2);
    assert.deepEqual(logs.map(({ confirmed_at: _confirmedAt, ...other }) => other), before.map(({ confirmed_at: _confirmedAt, ...other }) => other));
  } finally { globalThis.fetch = original; }
});

test("APIは200件境界を守り、不正な入力・送信元・操作ヘッダーをDB呼出前に拒否する", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => { calls++; return Response.json(init?.method === "POST" ? 0 : []); };
  try {
    for (const input of [[], [0], [-1], [1.2], ["1"], Array.from({ length: 201 }, (_, i) => i + 1)]) {
      assert.equal((await confirmRoute({ request: browserRequest(input), env })).status, 400);
    }
    assert.equal((await confirmRoute({ request: browserRequest([1], { Origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await confirmRoute({ request: browserRequest([1], { "X-Dashboard-Action": "" }), env })).status, 403);
    assert.equal(calls, 0);
    const response = await confirmRoute({ request: browserRequest(Array.from({ length: 200 }, (_, i) => i + 1)), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { confirmed: 0, confirmedIds: [] });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("APIはRPC件数・DB行の壊れた応答と再取得失敗を成功に置き換えない", async () => {
  const original = globalThis.fetch;
  try {
    for (const value of [null, "0", -1, 1.1, 2]) {
      globalThis.fetch = async () => Response.json(value);
      assert.equal((await confirmRoute({ request: browserRequest([1]), env })).status, 502);
    }
    for (const value of [[{ id: 2, confirmed_at: STAMP, review_queue_id: 2 }],
      [{ id: 1, confirmed_at: STAMP }], [{ id: 1, confirmed_at: "invalid", review_queue_id: 2 }],
      [{ id: 1, confirmed_at: STAMP, review_queue_id: 0 }],
      [{ id: 1, confirmed_at: STAMP, review_queue_id: 2 }, { id: 1, confirmed_at: STAMP, review_queue_id: 2 }]]) {
      globalThis.fetch = async (_input, init) => Response.json(init?.method === "POST" ? 1 : value);
      assert.equal((await confirmRoute({ request: browserRequest([1]), env })).status, 502);
    }
    globalThis.fetch = async (_input, init) => init?.method === "POST" ? Response.json(1) : Response.json({ error: "failed" }, { status: 503 });
    assert.equal((await confirmRoute({ request: browserRequest([1]), env })).status, 502);
  } finally { globalThis.fetch = original; }
});

test("学習ログAPIのclientは1000件を超えた全ページを取得し、途中失敗で部分配列を返さない", async () => {
  const logs = rows(2101);
  const original = globalThis.fetch;
  const offsets: number[] = [];
  let fail = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://dashboard.example");
    const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
    if (fail && offset === 1000) return Response.json({ error: "page failure" }, { status: 502 });
    return Response.json({ items: logs.slice(offset, offset + 1000), total: logs.length, limit: 1000, offset });
  };
  try {
    assert.equal((await getQuizLog()).length, 2101);
    assert.deepEqual(offsets, [0, 1000, 2000]);
    fail = true;
    await assert.rejects(() => getQuizLog(), /page failure/);
  } finally { globalThis.fetch = original; }
});

test("全件数が分かるページの欠落を空の全件一覧・全件完了と誤認しない", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ items: [], total: 1098, limit: 1000, offset: 0 });
    await assert.rejects(() => getQuizLog(), /ページ件数が全件数と一致しません/);
    globalThis.fetch = async (input) => {
      const offset = Number(new URL(String(input), "https://dashboard.example").searchParams.get("offset"));
      // 1000件以上の途中ページ欠落も、末尾が正常だからと部分配列を返さない。
      return Response.json({ items: offset === 1000 ? rows(10) : rows(offset === 0 ? 1000 : 101), total: 2101, limit: 1000, offset });
    };
    await assert.rejects(() => getQuizLog(), /ページ件数が全件数と一致しません/);
  } finally { globalThis.fetch = original; }
});

test("サーバー上限で1ページが短くても、全件数がある一覧を末尾まで取得する", async () => {
  const original = globalThis.fetch;
  const logs = rows(1098);
  const offsets: number[] = [];
  globalThis.fetch = async (input) => {
    const offset = Number(new URL(String(input), "https://dashboard.example").searchParams.get("offset"));
    offsets.push(offset);
    return Response.json({ items: logs.slice(offset, offset + 30), total: logs.length, limit: 1000, offset });
  };
  try {
    assert.deepEqual(idsOf(await getQuizLog()), idsOf(logs));
    assert.equal(offsets.length, 37);
  } finally { globalThis.fetch = original; }
});
