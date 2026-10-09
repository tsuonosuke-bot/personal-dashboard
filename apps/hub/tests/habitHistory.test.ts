import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { habitHistoryRange, normalizeHabitHistory, readHabitHistoryQuery } from "../functions/_shared/habits.ts";
import { onRequest as historyRoute } from "../functions/api/habit-history.ts";

// 2026-10-09（金）12:00 JST
const NOW = new Date("2026-10-09T03:00:00Z");
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const query = (search: string) => readHabitHistoryQuery(new URL(`https://hub.example/api/habit-history${search}`), NOW);

test("履歴の期間指定は今週・今月を既定にし、週は月曜へ丸め、未来や不正な値を拒否する", () => {
  assert.deepEqual(query(""), { ok: true, value: { period: "week", anchor: "2026-10-05" } });
  assert.deepEqual(query("?period=week&anchor=2026-09-03"), { ok: true, value: { period: "week", anchor: "2026-08-31" } });
  assert.deepEqual(query("?period=month"), { ok: true, value: { period: "month", anchor: "2026-10" } });
  assert.deepEqual(query("?period=month&anchor=2026-08"), { ok: true, value: { period: "month", anchor: "2026-08" } });
  for (const bad of ["?period=week&anchor=2026-10-12", "?period=week&anchor=2026-13-01", "?period=month&anchor=2026-11", "?period=month&anchor=2026-8", "?period=year"]) {
    assert.equal(query(bad).ok, false, bad);
  }
  assert.deepEqual(habitHistoryRange({ period: "month", anchor: "2026-09" }).weeks, ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(habitHistoryRange({ period: "month", anchor: "2026-02" }).to, "2026-02-28");
});

const habits = [
  { id: 1, name: "毎日", cadence: "daily", status: "active", started_on: "2026-09-10" },
  { id: 2, name: "平日", cadence: "weekdays", status: "active", started_on: "2026-08-01" },
  { id: 3, name: "毎週", cadence: "weekly", status: "active", started_on: "2026-09-02" },
  { id: 4, name: "自由", cadence: "flexible", status: "paused", started_on: "2026-08-01" },
  { id: 5, name: "昔の習慣", cadence: "daily", status: "archived", started_on: "2026-01-01" },
];
const logs = [
  ...["2026-09-10", "2026-09-11", "2026-09-30"].map((date, i) => ({ id: 10 + i, habit_id: 1, practiced_on: date })),
  ...["2026-09-01", "2026-09-07", "2026-09-08"].map((date, i) => ({ id: 20 + i, habit_id: 2, practiced_on: date })),
  // 8/31週の記録は9/2（開始日）より前の8/31。9/7週・9/28週は実施
  ...["2026-08-31", "2026-09-09", "2026-10-01"].map((date, i) => ({ id: 30 + i, habit_id: 3, practiced_on: date })),
  ...["2026-09-05", "2026-09-06"].map((date, i) => ({ id: 40 + i, habit_id: 4, practiced_on: date })),
];

test("過去の月を、毎日・平日は日ごと、毎週は週ごと、自由は回数で集計する", () => {
  const month = normalizeHabitHistory(habits, logs, { period: "month", anchor: "2026-09" }, NOW);
  const byId = new Map(month.habits.map((habit) => [habit.id, habit]));
  // 毎日: 9/10開始なので対象は9/10〜9/30の21日
  assert.deepEqual([byId.get(1)?.done, byId.get(1)?.target, byId.get(1)?.unit], [3, 21, "日"]);
  // 平日: 9月の平日22日
  assert.deepEqual([byId.get(2)?.done, byId.get(2)?.target], [3, 22]);
  // 毎週: 9月に重なる5週。8/31の週は開始日(9/2)を含むので対象、8/31の記録で実施済み
  const weekly = byId.get(3);
  assert.deepEqual(weekly?.weeks?.map((week) => [week.weekStart, week.eligible, week.completedOn]), [
    ["2026-08-31", true, "2026-08-31"], ["2026-09-07", true, "2026-09-09"], ["2026-09-14", true, null], ["2026-09-21", true, null], ["2026-09-28", true, "2026-10-01"],
  ]);
  assert.deepEqual([weekly?.done, weekly?.target, weekly?.unit], [3, 5, "週"]);
  // 自由: 分母なしの回数
  assert.deepEqual([byId.get(4)?.done, byId.get(4)?.target, byId.get(4)?.unit], [2, null, "回"]);
  // 記録のないアーカイブは出さない
  assert.equal(byId.has(5), false);
  assert.equal(month.previousAnchor, "2026-08");
  assert.equal(month.nextAnchor, "2026-10");
});

test("今週は今日より後を対象外にし、次の期間へは進めない", () => {
  const week = normalizeHabitHistory(habits, logs, { period: "week", anchor: "2026-10-05" }, NOW);
  const daily = week.habits.find((habit) => habit.id === 1);
  assert.deepEqual(daily?.days?.map((day) => [day.date, day.future, day.eligible]).slice(3), [
    ["2026-10-08", false, true], ["2026-10-09", false, true], ["2026-10-10", true, false], ["2026-10-11", true, false],
  ]);
  assert.equal(daily?.target, 5);
  assert.equal(week.nextAnchor, null);
  assert.equal(week.previousAnchor, "2026-09-28");
});

test("履歴APIは毎週の判定のため最初の週の月曜から記録を読み、不正な期間は400にする", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => { urls.push(decodeURIComponent(String(input))); return Response.json([]); };
  try {
    const bad = await historyRoute({ request: new Request("https://hub.example/api/habit-history?period=month&anchor=2099-01"), env });
    assert.equal(bad.status, 400);
    const ok = await historyRoute({ request: new Request("https://hub.example/api/habit-history?period=month&anchor=2026-09"), env });
    assert.equal(ok.status, 200);
  } finally { globalThis.fetch = originalFetch; }
  const logUrl = urls.find((url) => url.includes("/habit_logs"));
  assert.match(logUrl ?? "", /practiced_on=gte\.2026-08-31&practiced_on=lte\.2026-10-04/);
});

test("Habits画面は週・月の切り替えと前後の期間移動で履歴を読み直す", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-history-period="week"[\s\S]*data-history-period="month"/);
  assert.match(html, /id="historyPrev"[\s\S]*id="historyNext"/);
  assert.match(html, /id="historyWeekly"/);
  assert.doesNotMatch(html, /直近7日間/);
  assert.match(script, /fetch\(`\/api\/habit-history\?\$\{params\}`/);
  assert.match(script, /state\.history\.anchor = state\.history\.data\.previousAnchor/);
  assert.match(script, /els\.historyNext\.disabled = state\.history\.loading \|\| !data\.nextAnchor/);
});
