import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSpeakingLog, jstDate, speakingDailyCounts, speakingPeriodStart, speakingSummary,
} from "../src/lib/speakingLog.ts";
import type { Knowledge, SpeakingPracticeLog } from "../src/types.ts";

const K1 = "11111111-1111-4111-8111-111111111111";
const knowledge = [{ id: K1, title: "Would you mind ~ing" }] as Knowledge[];

function log(id: number, practicedAt: string, patch: Partial<SpeakingPracticeLog> = {}): SpeakingPracticeLog {
  return {
    id,
    attempt_id: `attempt_${id}_12345678901234567890`,
    session_id: "session",
    knowledge_id: K1,
    practice_type: "instant_composition",
    rating: "smooth",
    answer_text: "Would you mind checking this?",
    repetitions: 1,
    practiced_at: practicedAt,
    ...patch,
  };
}

test("練習日は日本時間で数える", () => {
  // UTC 9/27 15:30 は日本時間 9/28 0:30
  assert.equal(jstDate("2026-09-27T15:30:00Z"), "2026-09-28");
  assert.equal(jstDate("2026-09-27T14:59:00Z"), "2026-09-27");
});

test("期間・練習の種類・評価で絞り、新しい順に並べる。引けないナレッジも残す", () => {
  const logs = [
    log(1, "2026-09-01T01:00:00Z"),
    log(2, "2026-09-27T01:00:00Z", { rating: "retry" }),
    log(3, "2026-09-28T01:00:00Z", { practice_type: "read_aloud", repetitions: 3 }),
    log(4, "2026-09-28T02:00:00Z", { knowledge_id: "22222222-2222-4222-8222-222222222222" }),
  ];
  const week = buildSpeakingLog(logs, knowledge, { period: "7", type: "all", rating: "all" }, "2026-09-28");
  assert.deepEqual(week.map((entry) => entry.id), [4, 3, 2]);
  assert.equal(week[0].title, "（削除されたナレッジ）");
  assert.equal(week[1].title, "Would you mind ~ing");

  const readAloud = buildSpeakingLog(logs, knowledge, { period: "all", type: "read_aloud", rating: "all" }, "2026-09-28");
  assert.deepEqual(readAloud.map((entry) => entry.id), [3]);
  const retry = buildSpeakingLog(logs, knowledge, { period: "all", type: "all", rating: "retry" }, "2026-09-28");
  assert.deepEqual(retry.map((entry) => entry.id), [2]);
});

test("日別の回数は練習しなかった日も0件で並べ、評価ごとに数える", () => {
  const logs = [
    log(1, "2026-09-26T01:00:00Z"),
    log(2, "2026-09-26T02:00:00Z", { rating: "almost" }),
    log(3, "2026-09-28T01:00:00Z", { rating: "retry" }),
  ];
  const entries = buildSpeakingLog(logs, knowledge, { period: "all", type: "all", rating: "all" }, "2026-09-28");
  const from = speakingPeriodStart("all", "2026-09-28", logs);
  assert.equal(from, "2026-09-26");
  assert.deepEqual(speakingDailyCounts(entries, from, "2026-09-28"), [
    { date: "2026-09-26", smooth: 1, almost: 1, retry: 0, total: 2 },
    { date: "2026-09-27", smooth: 0, almost: 0, retry: 0, total: 0 },
    { date: "2026-09-28", smooth: 0, almost: 0, retry: 1, total: 1 },
  ]);
  assert.deepEqual(speakingSummary(entries), { total: 3, days: 2, smooth: 1, smoothRate: 33 });
  assert.equal(speakingSummary([]).smoothRate, null);
  assert.equal(speakingPeriodStart("all", "2026-09-28", []), "2026-09-28");
  assert.equal(speakingPeriodStart("30", "2026-09-28", logs), "2026-08-30");
});

test("学習ログに英会話練習のタブを置き、練習記録を全件取得して見返せる", async () => {
  const [view, panel] = await Promise.all([
    readFile(new URL("../src/components/LearningLogView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/SpeakingLogPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(view, />英会話練習<\/button>/);
  assert.match(view, /<SpeakingLogPanel knowledge=\{knowledge\}/);
  assert.match(panel, /getSpeakingPracticeLog\(ALL_TIME\)/);
  assert.match(panel, /<Bar key=\{rating\} dataKey=\{rating\} stackId="rating"/);
  assert.match(panel, /entry\.answer_text/);
  // 1つの縦軸だけを使う
  assert.equal(panel.match(/<YAxis/g)?.length, 1);
});
