import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DashboardError } from "../functions/_shared/dashboard.ts";
import {
  applyHabitLog,
  mondayOf,
  normalizeHabits,
  todayInTokyo,
} from "../functions/_shared/habits.ts";
import { onRequest as habitsRoute } from "../functions/api/habits.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function mutationRequest(method: "POST" | "PATCH", action: string, body: unknown) {
  return new Request("https://dashboard.example/api/habits", {
    method,
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
    },
    body: JSON.stringify(body),
  });
}

test("JSTの日付と月曜始まりの週を判定する", () => {
  const sundayUtc = new Date("2026-09-19T15:05:00.000Z");
  assert.equal(todayInTokyo(sundayUtc), "2026-09-20");
  assert.equal(mondayOf("2026-09-20"), "2026-09-14");
});

test("毎日・平日・毎週・自由頻度を穏やかな達成判定へ正規化する", () => {
  const now = new Date("2026-09-20T03:00:00.000Z"); // Sunday in Tokyo
  const dashboard = normalizeHabits([
    { id: 1, name: "毎日の習慣", cadence: "daily", status: "active", started_on: "2026-09-01", updated_at: "2026-09-20T00:00:00Z" },
    { id: 2, name: "平日の習慣", cadence: "weekdays", status: "active", started_on: "2026-09-01", updated_at: "2026-09-20T00:00:00Z" },
    { id: 3, name: "週の習慣", cadence: "weekly", status: "active", started_on: "2026-09-01", updated_at: "2026-09-20T00:00:00Z" },
    { id: 4, name: "自由な習慣", cadence: "flexible", status: "active", started_on: "2026-09-01", updated_at: "2026-09-20T00:00:00Z" },
    { id: 5, name: "休止中", cadence: "daily", status: "paused", started_on: "2026-09-01", updated_at: "2026-09-20T00:00:00Z" },
  ], [
    { id: 10, habit_id: 3, practiced_on: "2026-09-18", created_at: "2026-09-18T00:00:00Z" },
    { id: 11, habit_id: 4, practiced_on: "2026-09-20", created_at: "2026-09-20T00:00:00Z" },
  ], now);

  assert.equal(dashboard.today, "2026-09-20");
  assert.deepEqual(dashboard.summary, { total: 5, active: 4, completedToday: 1, remainingToday: 1 });
  assert.equal(dashboard.habits.find((habit) => habit.id === 2)?.eligibleToday, false);
  assert.equal(dashboard.habits.find((habit) => habit.id === 3)?.completedThisWeek, true);
  assert.equal(dashboard.habits.find((habit) => habit.id === 4)?.completedToday, true);
});

test("Habitを直接登録し、サーバー秘密情報を本文へ出さない", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: 8, name: "読書する", cadence: "daily", status: "active" }]);
  };
  try {
    const response = await habitsRoute({
      request: mutationRequest("POST", "habit-create", { name: "  読書する  ", purpose: "楽しむ", cadence: "daily" }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(new URL(seenUrl).pathname, "/rest/v1/habits");
    const body = JSON.parse(String(seenInit?.body));
    assert.equal(body.name, "読書する");
    assert.equal(body.source_want_id, null);
    assert.equal(body.source_route_id, null);
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
    assert.doesNotMatch(String(seenInit?.body), /secret-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Habit更新はupdated_atを条件にして競合を検知する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return Response.json([]);
  };
  try {
    const response = await habitsRoute({
      request: mutationRequest("PATCH", "habit-update", {
        id: 8,
        name: "読書する",
        purpose: null,
        cadence: "daily",
        status: "paused",
        original: { updatedAt: "2026-09-20T01:00:00.000Z" },
      }),
      env,
    });
    assert.equal(response.status, 409);
    assert.equal(new URL(seenUrl).searchParams.get("updated_at"), "eq.2026-09-20T01:00:00.000Z");
    assert.deepEqual(await response.json(), { error: "このHabitは別の画面で更新されています。再読み込みしてからやり直してください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("週次Habitは同じ週の2回目を拒否する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json([{ id: 3, name: "週次", cadence: "weekly", status: "active", started_on: "2026-09-01" }]);
    return Response.json([{ id: 22, habit_id: 3, practiced_on: "2026-09-18" }]);
  };
  try {
    await assert.rejects(
      () => applyHabitLog(env, { habitId: 3, practicedOn: "2026-09-20", completed: true }, new Date("2026-09-20T03:00:00Z")),
      (error: unknown) => error instanceof DashboardError && error.code === "HABIT_WEEK_ALREADY_COMPLETED" && error.status === 409,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Habit画面は今日・今週・7日履歴とモバイル操作を備える", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="todayList"/);
  assert.match(html, /id="weeklyList"/);
  assert.match(html, /id="historyTable"/);
  assert.match(script, /X-Dashboard-Action": "habit-log"/);
  assert.match(script, /original: \{ updatedAt: editing\.updatedAt \}/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
