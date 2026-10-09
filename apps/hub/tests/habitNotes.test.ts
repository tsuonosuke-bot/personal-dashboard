import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyHabitLog,
  normalizeHabitHistory,
  normalizeHabits,
  readHabitLogInput,
} from "../functions/_shared/habits.ts";

// #156: 履歴のセルから記録を直し、ひとことメモを残せる。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
// 2026-10-09（金）12:00 JST
const NOW = new Date("2026-10-09T03:00:00Z");
const daily = { id: 1, name: "読書", cadence: "daily", status: "active", started_on: "2026-09-01" };

function logRequest(body: unknown) {
  return new Request("https://dashboard.example/api/habit-logs", {
    method: "PATCH",
    headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "habit-log" },
    body: JSON.stringify(body),
  });
}

function fakeSupabase(existingLogs: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    if (url.pathname.endsWith("/habits")) return Response.json([daily]);
    if (method === "GET") return Response.json(existingLogs);
    if (method === "PATCH") return Response.json([{ ...existingLogs[0], ...body }]);
    return Response.json([{ id: 10, habit_id: 1, ...body }], { status: 201 });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("記録APIはメモを任意で受け付け、空白だけのメモは消す指定として扱う", async () => {
  const withNote = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true, note: "  朝に読めた " }));
  assert.deepEqual(withNote, { ok: true, value: { habitId: 1, practicedOn: "2026-10-08", completed: true, note: "朝に読めた" } });
  const cleared = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true, note: "   " }));
  assert.equal(cleared.ok && cleared.value.note, null);
  const withoutNote = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true }));
  assert.equal(withoutNote.ok && "note" in withoutNote.value, false);

  const tooLong = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true, note: "あ".repeat(2001) }));
  assert.equal(tooLong.ok, false);
  const notText = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true, note: 3 }));
  assert.equal(notText.ok, false);
  const noteOnCancel = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: false, note: "x" }));
  assert.equal(noteOnCancel.ok, false);
  const extraKey = await readHabitLogInput(logRequest({ habitId: 1, practicedOn: "2026-10-08", completed: true, memo: "x" }));
  assert.equal(extraKey.ok, false);
});

test("未記録の日はメモ付きで記録し、記録済みの日はメモだけを書き換える", async () => {
  const fresh = fakeSupabase();
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-08", completed: true, note: "朝に読めた" }, NOW);
    const insert = fresh.calls.find((call) => call.method === "POST");
    assert.equal(insert?.body?.note, "朝に読めた");
  } finally {
    fresh.restore();
  }

  const recorded = fakeSupabase([{ id: 7, habit_id: 1, practiced_on: "2026-10-08", note: null }]);
  try {
    const result = await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-08", completed: true, note: "夜に追記" }, NOW);
    const update = recorded.calls.find((call) => call.method === "PATCH");
    assert.equal(update?.url.searchParams.get("id"), "eq.7");
    assert.deepEqual(update?.body, { note: "夜に追記" });
    assert.equal(result.completed, true);
    assert.equal(recorded.calls.some((call) => call.method === "POST"), false);
  } finally {
    recorded.restore();
  }

  // メモを送らない記録（Hub・今日のカード）では、既存のメモに触れない
  const untouched = fakeSupabase([{ id: 7, habit_id: 1, practiced_on: "2026-10-08", note: "残す" }]);
  try {
    await applyHabitLog(env, { habitId: 1, practicedOn: "2026-10-08", completed: true }, NOW);
    assert.equal(untouched.calls.some((call) => call.method === "PATCH" || call.method === "POST"), false);
  } finally {
    untouched.restore();
  }
});

test("直近7日の履歴と週・月の履歴にメモを返す", () => {
  const recent = normalizeHabits([daily], [
    { id: 1, habit_id: 1, practiced_on: "2026-10-08", note: "朝に読めた", created_at: "2026-10-08T01:00:00Z" },
  ], NOW);
  assert.equal(recent.habits[0].history.find((day) => day.date === "2026-10-08")?.note, "朝に読めた");
  assert.equal(recent.habits[0].history.find((day) => day.date === "2026-10-07")?.note, null);

  const history = normalizeHabitHistory(
    [daily, { ...daily, id: 2, cadence: "weekly" }],
    [
      { id: 1, habit_id: 1, practiced_on: "2026-10-06", note: "電車で", created_at: "2026-10-06T01:00:00Z" },
      { id: 2, habit_id: 2, practiced_on: "2026-10-07", note: "まとめて", created_at: "2026-10-07T01:00:00Z" },
    ],
    { period: "week", anchor: "2026-10-05" },
    NOW,
  );
  assert.equal(history.habits[0].days?.find((day) => day.date === "2026-10-06")?.note, "電車で");
  assert.equal(history.habits[1].weeks?.[0].note, "まとめて");
});

test("Habits画面は履歴のセルと今日のカードから記録シートを開き、メモのある記録に印を付ける", async () => {
  const [script, css, html] = await Promise.all([
    readFile(new URL("../public/habits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
  ]);
  for (const id of ["logSheet", "logSheetCompleted", "logSheetDay", "logSheetNote", "logSheetNoteView", "logSheetSave"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="logSheetNote" maxlength="2000"/);
  assert.match(script, /data-sheet-week="\$\{week\.weekStart\}"/);
  assert.match(script, /data-note-id="\$\{habit\.id\}"/);
  assert.match(script, /7日より前の記録は見るだけです/);
  assert.match(script, /completed: true, note \}/);
  assert.match(script, /保存すると、この日の記録とメモが消えます/);
  assert.match(css, /td\.has-note::before/);
  assert.match(css, /\.log-sheet \{/);
});
