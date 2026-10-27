import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { focusKnowledgeList } from "../src/lib/knowledgeListJump.ts";
import { datedHubAnswers } from "../functions/_shared/hubSummary.ts";
import { onRequest } from "../functions/api/hub-summary.ts";

test("一覧へジャンプして非入力見出しへフォーカスし、遅延描画後も利用者の次の操作までは位置を保つ", () => {
  const doc = new EventTarget() as EventTarget & { activeElement: unknown };
  let moves = 0, disconnected = 0, onResize = () => {};
  const heading = { ownerDocument: doc, focus: (options: FocusOptions) => {
    assert.equal(options.preventScroll, true); doc.activeElement = heading;
  }, scrollIntoView: (options: ScrollIntoViewOptions) => { assert.equal(options.block, "start"); moves++; } };
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {} disconnect() { disconnected++; }
  } as unknown as typeof ResizeObserver;
  try {
    const stop = focusKnowledgeList(heading as unknown as HTMLElement, {} as HTMLElement);
    assert.equal(doc.activeElement, heading); assert.equal(moves, 1);
    onResize(); assert.equal(moves, 2);
    doc.dispatchEvent(new Event("wheel"));
    onResize(); assert.equal(moves, 2); assert.equal(disconnected, 1);
    stop();
    const nextStop = focusKnowledgeList(heading as unknown as HTMLElement, {} as HTMLElement);
    doc.activeElement = null;
    onResize(); assert.equal(moves, 3);
    nextStop();
  } finally { globalThis.ResizeObserver = original; }
});

test("一覧ジャンプは既存状態を変更するハンドラを呼ばず、短い終了案内は開始可能な時だけ出す", async () => {
  const [dashboard, panel, review, help] = await Promise.all([
    readFile(new URL("../src/components/KnowledgeDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TodayLearningPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/HelpView.tsx", import.meta.url), "utf8"),
  ]);
  const jump = dashboard.slice(dashboard.indexOf("const jumpToList"), dashboard.indexOf("return (", dashboard.indexOf("const jumpToList")));
  assert.match(jump, /focusKnowledgeList/);
  assert.doesNotMatch(jump, /setPage|setSort|updateFilters|clearFilters|history|setSearchOpen/);
  assert.match(dashboard, /onClick=\{jumpToList\}[^>]*>ナレッジ一覧へ/);
  assert.match(dashboard, /ref=\{listHeading\}[^>]*tabIndex=\{-1\}/);
  assert.match(panel, /const showExitHint = !loading && !error && !queueLoading && !queueError && readyDue > 0/);
  assert.match(panel, /showExitHint && <span[^>]*>途中で終了できます<\/span>/);
  assert.match(panel, /aria-describedby=\{showExitHint \? "today-learning-exit-hint" : undefined\}/);
  assert.doesNotMatch(panel, /いつでも終了|未送信.*保存|5問モード/);
  assert.match(review, /onClick=\{session.stop\} disabled=\{session.busy\}>終了する/);
  assert.match(help, /未送信の入力は記録されず、送信済みの回答は残ります/);
  assert.match(help, /送信を受理しただけの採点待ち回答は、まだ含みません/);
});

test("Hub回答数は日付付きの安全な件数だけを認め、欠落・無効を0と扱わない", () => {
  assert.deepEqual(datedHubAnswers({ date: "2026-10-27", todayAnswered: 3 }), { date: "2026-10-27", todayAnswered: 3 });
  assert.deepEqual(datedHubAnswers({ date: "2026-10-27", todayAnswered: 0 }), { date: "2026-10-27", todayAnswered: 0 });
  for (const data of [{}, { date: "2026-10-27" }, { todayAnswered: 2 }, { date: "2026-02-30", todayAnswered: 2 },
    { date: "2026-10-27", todayAnswered: -1 }, { date: "2026-10-27", todayAnswered: "2" },
    { date: "2026-10-27", todayAnswered: 1.5 }, { date: "2026-10-27", todayAnswered: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.deepEqual(datedHubAnswers(data), { date: null, todayAnswered: null });
  }
});

test("Hub APIは旧DBや回答数の部分失敗でも既知のキューを残し、全履歴を取得しない", async () => {
  const original = globalThis.fetch;
  let data: unknown = { date: "2026-10-27", todayAnswered: 4, reviewStatus: { ready_due: 0, waiting_grading: 2 } };
  let calls = 0;
  globalThis.fetch = async (url) => { calls++; assert.match(String(url), /rpc\/get_knowledge_hub_summary$/); return Response.json(data); };
  const request = () => new Request("https://knowledge.example/api/hub-summary?today=2026-10-27");
  const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };
  try {
    assert.equal((await (await onRequest({ env, request: request() })).json()).todayAnswered, 4);
    data = { reviewStatus: { ready_due: 7 } };
    assert.deepEqual(await (await onRequest({ env, request: request() })).json(), { reviewStatus: { ready_due: 7 }, date: null, todayAnswered: null });
    data = { date: "invalid", todayAnswered: 4, reviewStatus: { ready_due: 3 } };
    assert.deepEqual(await (await onRequest({ env, request: request() })).json(), { reviewStatus: { ready_due: 3 }, date: null, todayAnswered: null });
    data = [];
    assert.equal((await onRequest({ env, request: request() })).status, 502);
    assert.equal(calls, 4);
  } finally { globalThis.fetch = original; }
});
