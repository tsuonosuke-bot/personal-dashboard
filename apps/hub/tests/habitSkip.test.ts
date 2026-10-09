import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyHabitLog,
  normalizeHabitHistory,
  normalizeHabits,
  readHabitLogInput,
} from "../functions/_shared/habits.ts";
import { habitGroups, habitNote, habitStreak, missedYesterday, renderHabitSection } from "../public/today-panel.js";

// #164: 休んだ日を記録し、達成率と連続記録から外す。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
// 2026-10-08（木）12:00 JST
const NOW = new Date("2026-10-08T03:00:00Z");

function habit(id: number, cadence: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Habit ${id}`, purpose: null, cadence, status: "active", started_on: "2026-09-01", target_per_week: 1, ...extra };
}

function log(id: number, habitId: number, practicedOn: string, kind = "done", note: string | null = null) {
  return { id, habit_id: habitId, practiced_on: practicedOn, kind, note, created_at: `${practicedOn}T03:00:00Z` };
}

function logRequest(body: unknown) {
  return new Request("https://dashboard.example/api/habit-logs", {
    method: "PATCH",
    headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "habit-log" },
    body: JSON.stringify(body),
  });
}

function fakeSupabase(existing: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    if (url.pathname.endsWith("/habits")) return Response.json([habit(1, "daily")]);
    if (method === "GET") return Response.json(existing);
    if (method === "PATCH") return Response.json([{ ...existing[0], ...body }]);
    return Response.json([{ id: 10, ...body }], { status: 201 });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("記録APIは種類（実施／休んだ）を任意で受け付け、取消には付けさせない", async () => {
  const skip = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-07", completed: true, kind: "skip", note: "発熱" }));
  assert.deepEqual(skip, { ok: true, value: { habitId: 1, practicedOn: "2026-10-07", completed: true, note: "発熱", kind: "skip" } });
  const plain = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-07", completed: true }));
  assert.equal(plain.ok && "kind" in plain.value, false);
  assert.equal((await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-07", completed: true, kind: "rest" }))).ok, false);
  assert.equal((await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-07", completed: false, kind: "skip" }))).ok, false);
});

test("休んだ日は kind=skip で記録し、同じ日の記録は種類だけを書き換える", async () => {
  const fresh = fakeSupabase();
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-07", completed: true, kind: "skip", note: "発熱" }, NOW);
    const insert = fresh.calls.find((call) => call.method === "POST");
    assert.equal(insert?.body?.kind, "skip");
    assert.equal(insert?.body?.note, "発熱");
  } finally {
    fresh.restore();
  }
  // 休んだ日を「実施」に切り替える（Hubのチップなど kind を送らない記録も実施になる）。メモはそのまま
  const skipped = fakeSupabase([log(7, 1, "2026-10-07", "skip", "発熱")]);
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-07", completed: true }, NOW);
    const update = skipped.calls.find((call) => call.method === "PATCH");
    assert.deepEqual(update?.body, { kind: "done" });
  } finally {
    skipped.restore();
  }
  const same = fakeSupabase([log(7, 1, "2026-10-07", "skip", "発熱")]);
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-07", completed: true, kind: "skip" }, NOW);
    assert.equal(same.calls.some((call) => call.method === "PATCH" || call.method === "POST"), false);
  } finally {
    same.restore();
  }
});

test("休んだ日は実施に数えず、今日の残りと先週の分母から外す", () => {
  const payload = normalizeHabits(
    [habit(1, "daily"), habit(2, "daily"), habit(3, "weekly", { target_per_week: 2 })],
    [
      log(1, 1, "2026-10-08", "skip", "発熱"),
      log(2, 1, "2026-10-07"),
      // 先週: 7日のうち2日休み、5日実施
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((date, index) => log(10 + index, 2, date)),
      log(20, 2, "2026-10-03", "skip"), log(21, 2, "2026-10-04", "skip"),
      // 毎週: 先週は1回だけで休みあり → 達成判定の対象外。今週も休みあり
      log(30, 3, "2026-09-30"), log(31, 3, "2026-10-02", "skip"), log(32, 3, "2026-10-06", "skip"),
    ],
    NOW,
  );
  const [rested, daily, weekly] = payload.habits;
  assert.equal(rested.completedToday, false);
  assert.equal(rested.skippedToday, true);
  assert.equal(rested.history.find((day) => day.date === "2026-10-08")?.skipped, true);
  assert.equal(weekly.skippedThisWeek, true);
  assert.equal(weekly.weeklyCount, 0);
  // 残りは「Habit 2（今日未記録）」だけ。休んだHabit 1と、休んだ週のHabit 3は数えない
  assert.equal(payload.summary.remainingToday, 1);
  const last = Object.fromEntries(payload.lastWeek.habits.map((item) => [item.id, item]));
  assert.deepEqual([last[2].done, last[2].target, last[2].achieved, last[2].skipped], [5, 5, true, 2]);
  assert.deepEqual([last[3].done, last[3].target, last[3].achieved, last[3].skipped], [1, 2, null, 1]);
  assert.equal(daily.id, 2);
});

test("週・月の履歴で、休んだ日を分母から外し、目標に届かず休んだ週を分母から外す", () => {
  const history = normalizeHabitHistory(
    [habit(1, "daily"), habit(2, "weekly", { target_per_week: 2 })],
    [
      log(1, 1, "2026-09-28"), log(2, 1, "2026-09-29", "skip"), log(3, 1, "2026-09-30"),
      log(4, 2, "2026-09-29"), log(5, 2, "2026-10-01", "skip"),
    ],
    { period: "week", anchor: "2026-09-28" },
    NOW,
  );
  const [daily, weekly] = history.habits;
  assert.equal(daily.days?.find((day) => day.date === "2026-09-29")?.skipped, true);
  assert.equal(daily.done, 2);
  assert.equal(daily.target, 6);
  assert.equal(daily.skipped, 1);
  assert.equal(weekly.weeks?.[0].skipped, true);
  assert.equal(weekly.weeks?.[0].eligible, false);
  assert.equal(weekly.target, 0);
});

test("Hub: 休んだ日は連続記録を切らず、今日の分母から外し、昨日の未記録から「休んだ」を記録できる", () => {
  const WEEK = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
  const days = (marks: string) => [...marks].map((mark, index) => ({ date: WEEK[index], eligible: true, completed: mark === "o", skipped: mark === "s" }));
  const base = {
    cadence: "daily" as const, status: "active" as const, startedOn: "2026-09-01", eligibleToday: true,
    completedToday: false, completedThisWeek: false, weeklyCompletedOn: null,
  };
  const streak = { ...base, id: 1, name: "英語", history: days("oosoo-o"), completedToday: true };
  assert.equal(habitStreak({ ...streak, history: days("ooosoo") }), 5);
  const rest = { ...base, id: 2, name: "ストレッチ", skippedToday: true, history: days("------s") };
  assert.equal(habitNote(rest, "2026-10-08"), "今日は休み");
  const open = { ...base, id: 3, name: "読書", history: days("-------") };
  const payload = { today: "2026-10-08", habits: [streak, rest, open] };
  const groups = habitGroups(payload);
  assert.equal(groups.dailyDone, 1);
  assert.equal(groups.dailyTarget, 2);
  const html = renderHabitSection({ status: "ready", data: payload, error: null });
  assert.match(html, /今日 1\/2/);
  assert.match(html, /data-habit-backfill-skip="3" aria-label="読書は昨日休んだ">休んだ/);
  // 昨日休んだHabitは「昨日の未記録」に出さない
  const yesterdaySkipped = { ...open, history: days("-----s-") };
  assert.deepEqual(missedYesterday({ today: "2026-10-08", habits: [yesterdaySkipped] }), []);
});

test("migrationと画面: kind 列、記録シートの3択、休んだ日の印", async () => {
  const [migration, html, script, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/202610100003_habit_log_skip.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /add column if not exists kind text not null default 'done'/);
  assert.match(migration, /check \(kind in \('done', 'skip'\)\)/);
  assert.doesNotMatch(migration, /^\s*(begin|commit);/m);
  for (const value of ["done", "skip", "none"]) assert.match(html, new RegExp(`name="logKind" value="${value}"`));
  assert.match(html, /／ 休んだ/);
  assert.match(script, /day\.skipped \? "／"/);
  assert.match(script, /今日は休み/);
  assert.match(css, /\.log-sheet-kind/);
});
