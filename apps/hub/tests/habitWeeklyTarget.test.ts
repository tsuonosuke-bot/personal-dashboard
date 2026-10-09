import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createHabit,
  updateHabit,
  normalizeHabitHistory,
  normalizeHabits,
  readHabitCreateInput,
  readHabitUpdateInput,
} from "../functions/_shared/habits.ts";

// #163: 毎週のHabitを「週N回」で記録し、先週の結果を振り返る。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
// 2026-10-08（木）12:00 JST。今週は 10/5〜、先週は 9/28〜10/4
const NOW = new Date("2026-10-08T03:00:00Z");

function habit(id: number, cadence: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Habit ${id}`, purpose: null, cadence, status: "active", started_on: "2026-09-01", target_per_week: 1, ...extra };
}

function log(id: number, habitId: number, practicedOn: string) {
  return { id, habit_id: habitId, practiced_on: practicedOn, note: null, created_at: `${practicedOn}T03:00:00Z` };
}

function createRequest(body: unknown, method = "POST") {
  return new Request("https://dashboard.example/api/habits", {
    method,
    headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": method === "POST" ? "habit-create" : "habit-update" },
    body: JSON.stringify(body),
  });
}

test("毎週のHabitは今週の回数が目標に届いたら達成とし、それまでは今日・今週の残りに数える", () => {
  const payload = normalizeHabits(
    [habit(1, "weekly", { target_per_week: 3 }), habit(2, "weekly", { target_per_week: 2 })],
    [log(1, 1, "2026-10-05"), log(2, 1, "2026-10-08"), log(3, 2, "2026-10-06"), log(4, 2, "2026-10-07"), log(5, 1, "2026-10-02")],
    NOW,
  );
  const [three, two] = payload.habits;
  assert.equal(three.targetPerWeek, 3);
  assert.equal(three.weeklyCount, 2);
  assert.deepEqual(three.weeklyDates, ["2026-10-05", "2026-10-08"]);
  assert.equal(three.completedThisWeek, false);
  assert.equal(three.completedToday, true);
  assert.equal(two.completedThisWeek, true);
  assert.equal(payload.summary.remainingToday, 1);
});

test("先週の結果は、毎日・平日は対象日の日数、毎週は回数と目標、自由は回数で出し、先週より後に始めたHabitは含めない", () => {
  const payload = normalizeHabits(
    [
      habit(1, "daily"),
      habit(2, "weekdays"),
      habit(3, "weekly", { target_per_week: 2 }),
      habit(4, "flexible"),
      habit(5, "daily", { started_on: "2026-10-02" }),
      habit(6, "daily", { started_on: "2026-10-06" }),
      habit(7, "daily", { status: "paused" }),
    ],
    [
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date, index) => log(10 + index, 1, date)),
      log(20, 2, "2026-09-29"), log(21, 2, "2026-10-04"),
      log(30, 3, "2026-09-28"), log(31, 3, "2026-10-01"),
      log(40, 4, "2026-09-30"),
      log(50, 5, "2026-10-03"),
      log(60, 1, "2026-10-05"),
    ],
    NOW,
  );
  assert.equal(payload.lastWeek.from, "2026-09-28");
  assert.equal(payload.lastWeek.to, "2026-10-04");
  assert.deepEqual(payload.lastWeek.habits.map((item) => [item.id, item.done, item.target, item.unit, item.achieved]), [
    [1, 7, 7, "日", true],
    // 平日は月〜金の5日。日曜の記録は数えない
    [2, 1, 5, "日", false],
    [3, 2, 2, "回", true],
    [4, 1, null, "回", null],
    // 10/2（金）開始 → 金〜日の3日
    [5, 1, 3, "日", false],
  ]);
});

test("週・月の履歴で、毎週のHabitは週ごとの回数と、日ごとの記録の両方を返す", () => {
  const history = normalizeHabitHistory(
    [habit(1, "weekly", { target_per_week: 2 })],
    [log(1, 1, "2026-09-29"), log(2, 1, "2026-10-01"), log(3, 1, "2026-10-06")],
    { period: "week", anchor: "2026-09-28" },
    NOW,
  );
  const [weekly] = history.habits;
  assert.equal(weekly.targetPerWeek, 2);
  assert.equal(weekly.weeks?.[0].count, 2);
  assert.deepEqual(weekly.weeks?.[0].dates, ["2026-09-29", "2026-10-01"]);
  assert.equal(weekly.weeks?.[0].completed, true);
  assert.equal(weekly.done, 1);
  assert.equal(weekly.dayCount, 2);
  assert.deepEqual(weekly.days?.filter((day) => day.completed).map((day) => day.date), ["2026-09-29", "2026-10-01"]);
  assert.ok(weekly.days?.every((day) => day.eligible));
});

test("週の回数は1〜7回で、毎週以外の頻度では1にそろえ、送られなければ1にする", async () => {
  const weekly = await readHabitCreateInput(createRequest({ name: "掃除", purpose: null, cadence: "weekly", targetPerWeek: 3 }));
  assert.equal(weekly.ok && weekly.value.targetPerWeek, 3);
  const daily = await readHabitCreateInput(createRequest({ name: "英語", purpose: null, cadence: "daily", targetPerWeek: 5 }));
  assert.equal(daily.ok && daily.value.targetPerWeek, 1);
  const omitted = await readHabitCreateInput(createRequest({ name: "掃除", purpose: null, cadence: "weekly" }));
  assert.equal(omitted.ok && omitted.value.targetPerWeek, 1);
  for (const targetPerWeek of [0, 8, 2.5, "3"]) {
    const result = await readHabitCreateInput(createRequest({ name: "掃除", purpose: null, cadence: "weekly", targetPerWeek }));
    assert.equal(result.ok, false, String(targetPerWeek));
  }
  const update = await readHabitUpdateInput(createRequest({
    id: 1, name: "掃除", purpose: null, cadence: "weekly", status: "active", targetPerWeek: 4,
    original: { updatedAt: "2026-10-01T00:00:00.000000+00:00" },
  }, "PATCH"));
  assert.equal(update.ok && update.value.targetPerWeek, 4);

  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json([{ id: 9, ...body }], { status: 201 });
  };
  try {
    await createHabit(env, { name: "掃除", purpose: null, cadence: "weekly", targetPerWeek: 3 }, NOW);
    assert.equal(body!.target_per_week, 3);
    await updateHabit(env, {
      id: 9, name: "掃除", purpose: null, cadence: "weekly", targetPerWeek: 2, status: "active",
      original: { updatedAt: "2026-10-01T00:00:00.000000+00:00" },
    }, NOW);
    assert.equal(body!.target_per_week, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrationは週の回数を1〜7で追加し、既存の W: キーを実施日の D: キーへ移す", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202610100002_habit_weekly_target.sql", import.meta.url), "utf8");
  assert.match(migration, /add column if not exists target_per_week smallint not null default 1/);
  assert.match(migration, /check \(target_per_week between 1 and 7\)/);
  assert.match(migration, /set tracking_key = 'D:' \|\| to_char\(practiced_on, 'YYYY-MM-DD'\)\s+where tracking_key like 'W:%';/);
  assert.doesNotMatch(migration, /^\s*(begin|commit);/m);
});

test("Habits画面で週の回数を設定でき、今週の進み具合と先週の結果を出す", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="habitTarget"/);
  assert.match(html, /過去の週も新しい目標で数え直します/);
  assert.match(script, /targetPerWeek: els\.habitCadence\.value === "weekly" \? Number\(els\.habitTarget\.value\) : 1/);
  assert.match(script, /今週 \$\{habit\.weeklyCount\}\/\$\{habit\.targetPerWeek\}回/);
  assert.match(script, /先週の結果/);
  assert.doesNotMatch(script, /weeklyDoneBeforeToday|今週完了/);
  assert.match(css, /\.last-week \{/);
});
