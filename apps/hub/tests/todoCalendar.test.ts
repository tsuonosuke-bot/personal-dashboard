import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatMonthDay,
  groupByDate,
  isDraggableTodo,
  monthGrid,
  monthLabel,
  planMove,
  shiftMonth,
  tokyoToday,
  type CalendarTodo,
  type TodoSchedule,
} from "../public/compass/calendar-grid.js";
import { readCompassScript } from "./compassScript.ts";

// 2026-10-05 12:00 JST
const now = new Date("2026-10-05T03:00:00Z");

const todo = (overrides: Omit<Partial<CalendarTodo>, "schedule"> & { schedule?: Partial<TodoSchedule> } = {}): CalendarTodo => ({
  id: 1,
  title: "歯医者",
  status: "pending",
  calendarState: "confirmed",
  calendarEtag: "etag-1",
  ...overrides,
  schedule: { allDay: false, date: "2026-10-08", startTime: "14:00", endTime: "15:00", timeZone: "Asia/Tokyo", ...overrides.schedule },
});

test("今日は日本時間の暦日で数える（UTCでは前日でも日本ではもう翌日）", () => {
  assert.equal(tokyoToday(new Date("2026-10-05T16:00:00Z")), "2026-10-06");
  assert.equal(tokyoToday(new Date("2026-10-05T14:59:00Z")), "2026-10-05");
});

test("月カレンダーは日曜始まりで、月をまたぐ週の前後の日も含める", () => {
  const grid = monthGrid("2026-10");
  assert.equal(grid.length, 5);
  assert.ok(grid.every((week) => week.length === 7));
  assert.deepEqual(grid[0][0], { date: "2026-09-27", inMonth: false });
  assert.deepEqual(grid[0][4], { date: "2026-10-01", inMonth: true });
  assert.deepEqual(grid[4][6], { date: "2026-10-31", inMonth: true });
  // 日曜に始まる28日の月は4週、土曜に始まる31日の月は6週になる。
  assert.equal(monthGrid("2026-02").length, 4);
  assert.equal(monthGrid("2025-03").length, 6);
  assert.equal(monthGrid("2025-03")[0][0].date, "2025-02-23");
});

test("月の移動は年をまたぎ、表示名は「年月」になる", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");
  assert.equal(monthLabel("2026-10"), "2026年10月");
  assert.equal(formatMonthDay("2026-10-12"), "10月12日（月）");
});

test("日付ごとにまとめ、終日→開始時刻→IDの順に並べる。日付のないToDoは除く", () => {
  const groups = groupByDate([
    todo({ id: 3, schedule: { startTime: "16:00", endTime: "17:00" } }),
    todo({ id: 2, schedule: { allDay: true, startTime: null, endTime: null } }),
    todo({ id: 4, schedule: { startTime: "09:00", endTime: "10:00" } }),
    todo({ id: 5, schedule: { date: "2026-10-09" } }),
    { id: 6, status: "pending", schedule: null },
  ]);
  assert.deepEqual(groups.get("2026-10-08")?.map((item) => item.id), [2, 4, 3]);
  assert.deepEqual(groups.get("2026-10-09")?.map((item) => item.id), [5]);
  assert.equal(groups.size, 2);
});

test("ドラッグできるのは、Calendarの予定と紐づいた未実施のToDoだけ", () => {
  assert.equal(isDraggableTodo(todo()), true);
  assert.equal(isDraggableTodo(todo({ status: "completed" })), false);
  assert.equal(isDraggableTodo(todo({ status: "skipped" })), false);
  assert.equal(isDraggableTodo(todo({ calendarState: "missing" })), false);
  assert.equal(isDraggableTodo(todo({ calendarState: "cancelled" })), false);
  assert.equal(isDraggableTodo(todo({ calendarState: "unavailable" })), false);
  assert.equal(isDraggableTodo(todo({ calendarEtag: null })), false);
});

test("別の日へ移すと日付だけが変わり、時刻と終日はそのまま", () => {
  const timed = planMove(todo(), "2026-10-12", now);
  assert.deepEqual(timed, {
    ok: true,
    schedule: { allDay: false, date: "2026-10-12", startTime: "14:00", endTime: "15:00", timeZone: "Asia/Tokyo" },
  });
  const allDay = planMove(todo({ schedule: { allDay: true, startTime: null, endTime: null } }), "2026-10-12", now);
  assert.deepEqual(allDay, {
    ok: true,
    schedule: { allDay: true, date: "2026-10-12", startTime: null, endTime: null, timeZone: "Asia/Tokyo" },
  });
});

test("同じ日・過去の日・移せないToDo・不正な日付は移さない", () => {
  assert.deepEqual(planMove(todo(), "2026-10-08", now), { ok: false, reason: "same-date" });
  assert.deepEqual(planMove(todo(), "2026-10-04", now), { ok: false, reason: "past" });
  assert.deepEqual(planMove(todo(), "2026-10-05", now), { ok: true, schedule: { allDay: false, date: "2026-10-05", startTime: "14:00", endTime: "15:00", timeZone: "Asia/Tokyo" } });
  assert.deepEqual(planMove(todo({ status: "completed" }), "2026-10-12", now), { ok: false, reason: "not-movable" });
  assert.deepEqual(planMove(todo(), "10/12", now), { ok: false, reason: "invalid" });
});

test("今日へ移すときは、終了時刻が現在より後のときだけ許す（サーバーの検証と同じ）", () => {
  const morning = todo({ schedule: { startTime: "09:00", endTime: "10:00", date: "2026-10-08" } });
  assert.deepEqual(planMove(morning, "2026-10-05", now), { ok: false, reason: "past" });
  const allDay = todo({ schedule: { allDay: true, startTime: null, endTime: null, date: "2026-10-08" } });
  assert.equal(planMove(allDay, "2026-10-05", now).ok, true);
  // 終日の予定でも、昨日には移せない。
  assert.deepEqual(planMove(allDay, "2026-10-04", now), { ok: false, reason: "past" });
});

test("画面は、ToDoタブの表示切り替えと、日付セルへのドロップで既存のreschedule APIを呼ぶ", async () => {
  const [script, html, css] = await Promise.all([
    readCompassScript(),
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="todoLayoutGroup"[^>]*hidden/);
  assert.match(html, /data-todo-layout="list"[\s\S]*data-todo-layout="calendar"/);
  assert.match(script, /state\.view === "todos" && state\.todoLayout === "calendar"/);
  assert.match(script, /sendTodoUpdate\(item, "reschedule", \{ schedule: plan\.schedule \}\)/);
  assert.match(script, /addEventListener\("drop"/);
  assert.match(script, /cell\.dataset\.date >= today/);
  assert.match(css, /\.calendar-day\.is-drop-target/);
  assert.match(css, /\.calendar-chip\[draggable="true"\]/);
});
