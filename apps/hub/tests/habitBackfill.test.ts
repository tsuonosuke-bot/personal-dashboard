import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DashboardError, publicError } from "../functions/_shared/dashboard.ts";
import {
  applyHabitLog,
  editableFrom,
  normalizeHabitHistory,
  normalizeHabits,
} from "../functions/_shared/habits.ts";

// #155: 過去7日までの記録漏れを後から記録・取消できる。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
// 2026-10-09（金）12:00 JST
const NOW = new Date("2026-10-09T03:00:00Z");

interface Captured { method: string; url: URL; body: Record<string, unknown> | null }

function fakeSupabase(habit: Record<string, unknown>, existingLogs: Array<Record<string, unknown>> = []) {
  const calls: Captured[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname.endsWith("/habits")) return Response.json([habit]);
    if (method === "GET") return Response.json(existingLogs);
    if (method === "DELETE") return Response.json([{ id: 9 }]);
    return Response.json([{ id: 10, habit_id: habit.id, practiced_on: calls[calls.length - 1]?.body?.practiced_on, note: null }], { status: 201 });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

const daily = { id: 1, name: "読書", cadence: "daily", status: "active", started_on: "2026-09-01" };

test("今日から7日前までは記録でき、8日前と未来は拒否する", async () => {
  const fake = fakeSupabase(daily);
  try {
    const yesterday = await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-08", completed: true }, NOW);
    assert.equal(yesterday.completed, true);
    const insert = fake.calls.find((call) => call.method === "POST");
    assert.deepEqual(insert?.body, { habit_id: 1, practiced_on: "2026-10-08", note: null, tracking_key: "D:2026-10-08" });

    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-02", completed: true }, NOW);
    for (const practicedOn of ["2026-10-01", "2026-10-10"]) {
      await assert.rejects(
        () => applyHabitLog(env, { habitId: 1, practicedOn, completed: true }, NOW),
        (error: unknown) => error instanceof DashboardError && error.code === "HABIT_DATE_INVALID" && error.status === 400,
        practicedOn,
      );
    }
    assert.match(publicError(new DashboardError("HABIT_DATE_INVALID", "x", 400)).message, /7日前まで/);
  } finally {
    fake.restore();
  }
});

test("取消は対象の日の記録だけを消す", async () => {
  const fake = fakeSupabase(daily);
  try {
    const result = await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-07", completed: false }, NOW);
    assert.deepEqual(result, { habitId: 1, practicedOn: "2026-10-07", completed: false });
    const deletion = fake.calls.find((call) => call.method === "DELETE");
    assert.equal(deletion?.url.searchParams.get("practiced_on"), "eq.2026-10-07");
    assert.equal(deletion?.url.searchParams.get("habit_id"), "eq.1");
  } finally {
    fake.restore();
  }
});

test("対象日かどうかは、今日ではなく記録する日で判定する", async () => {
  // 平日のHabit: 今日（金）は対象でも、10/4（日）は対象外
  const fake = fakeSupabase({ ...daily, cadence: "weekdays" });
  try {
    await assert.rejects(
      () => applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-04", completed: true }, NOW),
      (error: unknown) => error instanceof DashboardError && error.code === "HABIT_NOT_DUE",
    );
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-06", completed: true }, NOW);
  } finally {
    fake.restore();
  }
  // 開始日より前は記録できない
  const started = fakeSupabase({ ...daily, started_on: "2026-10-07" });
  try {
    await assert.rejects(
      () => applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-06", completed: true }, NOW),
      (error: unknown) => error instanceof DashboardError && error.code === "HABIT_NOT_DUE",
    );
  } finally {
    started.restore();
  }
});

test("毎週のHabitを先週の日付で記録すると、その日の行として書く", async () => {
  const weekly = { ...daily, cadence: "weekly" };
  const fake = fakeSupabase(weekly);
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-03", completed: true }, NOW);
    const lookup = fake.calls.find((call) => call.method === "GET" && call.url.pathname.endsWith("/habit_logs"));
    assert.deepEqual(lookup?.url.searchParams.getAll("practiced_on"), ["eq.2026-10-03"]);
    const insert = fake.calls.find((call) => call.method === "POST");
    assert.equal(insert?.body?.tracking_key, "D:2026-10-03");
  } finally {
    fake.restore();
  }
});

test("実施日より後の日に作った記録を「後から記録」として返し、記録できる最初の日を添える", () => {
  assert.equal(editableFrom("2026-10-09", "2026-09-01"), "2026-10-02");
  assert.equal(editableFrom("2026-10-09", "2026-10-05"), "2026-10-05");

  const habits = normalizeHabits([daily], [
    // 10/8の分を10/9 08:00 JSTに記録 → 後から記録
    { id: 1, habit_id: 1, practiced_on: "2026-10-08", note: null, created_at: "2026-10-08T23:00:00Z" },
    // 10/7の分を10/7 23:30 JSTに記録 → 当日
    { id: 2, habit_id: 1, practiced_on: "2026-10-07", note: null, created_at: "2026-10-07T14:30:00Z" },
  ], NOW);
  const history = habits.habits[0].history;
  assert.equal(history.find((day) => day.date === "2026-10-08")?.late, true);
  assert.equal(history.find((day) => day.date === "2026-10-07")?.late, false);
  assert.equal(habits.habits[0].editableFrom, "2026-10-02");

  const week = normalizeHabitHistory(
    [daily, { ...daily, id: 2, cadence: "weekly" }, { ...daily, id: 3, status: "paused" }],
    [
      { id: 1, habit_id: 1, practiced_on: "2026-10-08", created_at: "2026-10-08T23:00:00Z" },
      { id: 3, habit_id: 2, practiced_on: "2026-10-06", created_at: "2026-10-08T00:00:00Z" },
    ],
    { period: "week", anchor: "2026-10-05" },
    NOW,
  );
  const [first, second, paused] = week.habits;
  assert.equal(first.editableFrom, "2026-10-02");
  assert.equal(first.days?.find((day) => day.date === "2026-10-08")?.late, true);
  assert.equal(second.weeks?.[0].late, true);
  assert.equal(paused.editableFrom, null);
});

test("Habits画面の履歴は、直近7日のセルから記録シートを開き、後から記録に印を付ける", async () => {
  const [script, css, html] = await Promise.all([
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(script, /date >= editableFrom && date <= state\.data\.today/);
  assert.match(script, /data-sheet-date="\$\{day\.date\}"/);
  assert.match(script, /（後から記録）/);
  assert.match(css, /td\.late::after/);
  assert.match(css, /td\.editable button/);
  assert.match(html, /タップで記録・メモ（直近7日）/);
});
