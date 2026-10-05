import assert from "node:assert/strict";
import test from "node:test";
import {
  completedTodayCount,
  groupTodos,
  habitGroups,
  habitLocked,
  habitNote,
  habitStreak,
  projectRows,
  renderHabitSection,
  renderProjectSection,
  renderTodoSection,
  rescheduleRequest,
  todoPill,
  todoRequestBody,
  weekendDate,
  type TodayHabit,
  type TodayProject,
  type TodayTodo,
} from "../public/today-panel.js";

// 2026-10-05（月）09:30 JST
const NOW = new Date("2026-10-05T00:30:00Z");
const TODAY = "2026-10-05";

function todo(id: number, date: string | null, extra: Partial<TodayTodo> = {}): TodayTodo {
  return {
    id,
    status: "pending",
    title: `ToDo ${id}`,
    schedule: date ? { allDay: true, date, startTime: null, endTime: null, timeZone: "Asia/Tokyo" } : null,
    calendarState: "confirmed",
    calendarEtag: `"etag-${id}"`,
    note: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

// 直近7日（9/29火〜10/5月）
const WEEK = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];

function history(completed: boolean[], eligible: boolean[] = completed.map(() => true)) {
  return completed.map((done, index) => ({ date: WEEK[index], eligible: eligible[index], completed: done }));
}

function habit(id: number, cadence: TodayHabit["cadence"], extra: Partial<TodayHabit> = {}): TodayHabit {
  return {
    id,
    name: `Habit ${id}`,
    cadence,
    status: "active",
    startedOn: "2026-09-01",
    eligibleToday: cadence !== "weekly",
    completedToday: false,
    completedThisWeek: false,
    weeklyCompletedOn: null,
    history: history([false, false, false, false, false, false, false]),
    ...extra,
  };
}

function project(id: number, extra: Partial<TodayProject> = {}): TodayProject {
  const nextAction = { id: id * 10, content: `Next ${id}`, status: "next" as const, completedAt: null, updatedAt: "2026-09-23T00:00:00.000Z" };
  return {
    id,
    title: `Project ${id}`,
    status: "active",
    targetOn: null,
    reviewOn: null,
    nextAction,
    actions: [nextAction],
    ...extra,
  };
}

test("ToDo groups put overdue first (newest first) and only show the next 7 days", () => {
  const items = [
    todo(1, "2026-09-22"),
    todo(2, "2026-10-04"),
    todo(3, TODAY),
    todo(4, "2026-10-09"),
    todo(5, "2026-12-23"),
    todo(6, "2026-10-20"),
    todo(7, "2026-09-30", { status: "completed" }),
    todo(8, "2026-10-08", { calendarState: "missing" }),
    todo(9, TODAY, { schedule: { allDay: false, date: TODAY, startTime: "08:00", endTime: "09:00", timeZone: "Asia/Tokyo" } }),
  ];
  const groups = groupTodos(items, NOW);
  assert.deepEqual(groups.overdue.map((item) => item.id), [8, 9, 2, 1]);
  assert.deepEqual(groups.today.map((item) => item.id), [3]);
  assert.deepEqual(groups.soon.map((item) => item.id), [4]);
  assert.equal(groups.next?.id, 6);
});

test("ToDo pills read as days overdue, today or days ahead", () => {
  assert.deepEqual(todoPill(todo(1, "2026-10-04"), NOW), { tone: "overdue", label: "昨日" });
  assert.deepEqual(todoPill(todo(1, "2026-09-22"), NOW), { tone: "overdue", label: "13日超過" });
  assert.deepEqual(todoPill(todo(1, TODAY), NOW), { tone: "today", label: "今日" });
  assert.deepEqual(todoPill(todo(1, "2026-10-06"), NOW), { tone: "upcoming", label: "明日" });
  assert.deepEqual(todoPill(todo(1, "2026-10-08"), NOW), { tone: "upcoming", label: "3日後" });
  assert.deepEqual(todoPill(todo(1, TODAY, { calendarState: "cancelled" }), NOW), { tone: "overdue", label: "Calendarで取消済み" });
});

test("weekend is the coming Saturday, or next week's when opened on a weekend", () => {
  assert.equal(weekendDate("2026-10-05"), "2026-10-10");
  assert.equal(weekendDate("2026-10-09"), "2026-10-10");
  assert.equal(weekendDate("2026-10-10"), "2026-10-17");
  assert.equal(weekendDate("2026-10-11"), "2026-10-17");
});

test("rescheduling keeps the time of day, recreates missing events and refuses when it cannot", () => {
  const timed = todo(1, "2026-09-30", {
    schedule: { allDay: false, date: "2026-09-30", startTime: "20:00", endTime: "21:00", timeZone: "Asia/Tokyo" },
  });
  assert.deepEqual(rescheduleRequest(timed, "tomorrow", NOW), {
    command: "reschedule",
    schedule: { allDay: false, date: "2026-10-06", startTime: "20:00", endTime: "21:00", timeZone: "Asia/Tokyo" },
  });
  assert.equal((rescheduleRequest(todo(2, "2026-09-30"), "weekend", NOW) as { schedule: { date: string } }).schedule.date, "2026-10-10");
  assert.equal((rescheduleRequest(todo(3, "2026-09-30", { calendarState: "missing", calendarEtag: null }), "today", NOW) as { command: string }).command, "recreate");
  assert.match((rescheduleRequest(todo(4, "2026-09-30", { calendarState: "unavailable" }), "today", NOW) as { disabled: string }).disabled, /接続できない/);
  const morning = todo(5, "2026-09-30", {
    schedule: { allDay: false, date: "2026-09-30", startTime: "08:00", endTime: "09:00", timeZone: "Asia/Tokyo" },
  });
  assert.match((rescheduleRequest(morning, "today", NOW) as { disabled: string }).disabled, /過ぎている/);
});

test("ToDo updates keep the existing note and send the optimistic-lock snapshot", () => {
  const item = todo(1, "2026-09-30", { note: "メモ" });
  assert.deepEqual(todoRequestBody(item, "complete"), {
    id: 1,
    command: "complete",
    note: "メモ",
    schedule: null,
    original: { status: "pending", updatedAt: item.updatedAt, calendarEtag: item.calendarEtag, schedule: item.schedule },
  });
});

test("Habit notes show streaks, the last record and weekly status", () => {
  const twoDays = habit(1, "daily", { history: history([false, false, false, false, true, true, false]) });
  assert.equal(habitStreak(twoDays), 2);
  assert.equal(habitNote(twoDays, TODAY), "2日連続中");
  const doneToday = habit(2, "daily", { completedToday: true, history: history([false, false, false, false, false, true, true]) });
  assert.equal(habitNote(doneToday, TODAY), "今日 記録済み · 2日連続");
  const lapsed = habit(3, "daily", { history: history([false, false, false, false, true, false, false]) });
  assert.equal(habitNote(lapsed, TODAY), "前回 一昨日");
  assert.equal(habitNote(habit(4, "daily"), TODAY), "直近7日 記録なし");
  // 平日だけの習慣は土日を飛ばして数える
  const weekdays = habit(5, "weekdays", {
    history: history([false, false, true, true, false, false, false], [true, true, true, true, false, false, true]),
  });
  assert.equal(habitStreak(weekdays), 2);
  assert.equal(habitNote(habit(6, "weekly"), TODAY), "今週まだ");
  const weeklyEarlier = habit(7, "weekly", { completedThisWeek: true, weeklyCompletedOn: "2026-10-05" });
  assert.equal(habitNote(weeklyEarlier, TODAY), "今週分を記録済み");
  assert.equal(habitLocked(habit(8, "weekly", { completedThisWeek: true, weeklyCompletedOn: "2026-10-04" }), "2026-10-06"), true);
  assert.equal(habitLocked(weeklyEarlier, TODAY), false);
});

test("Habit groups count today's daily habits and this week's weekly habits", () => {
  const payload = {
    today: TODAY,
    habits: [
      habit(1, "daily", { completedToday: true }),
      habit(2, "daily"),
      habit(3, "weekly", { completedThisWeek: true }),
      habit(4, "weekly"),
      habit(5, "weekdays", { eligibleToday: false }),
      habit(6, "daily", { status: "paused" }),
    ],
  };
  const groups = habitGroups(payload);
  assert.deepEqual(groups.daily.map((item) => item.id), [1, 2]);
  assert.deepEqual(groups.weekly.map((item) => item.id), [3, 4]);
  assert.equal(groups.dailyDone, 1);
  assert.equal(groups.weeklyDone, 1);
  const html = renderHabitSection({ status: "ready", data: payload, error: null });
  assert.match(html, /今日 1\/2/);
  assert.match(html, /今週（週1回）· 1\/2/);
  assert.match(html, /data-habit-toggle="1" aria-pressed="true"/);
  assert.match(html, /data-habit-toggle="2" aria-pressed="false"/);
  assert.doesNotMatch(html, /Habit 5|Habit 6/);
});

test("Project rows surface overdue targets, missing next actions and due reviews first", () => {
  const rows = projectRows({
    projects: [
      project(1, { targetOn: "2027-01-24" }),
      project(2, { targetOn: "2026-10-03" }),
      project(3, { nextAction: null, actions: [] }),
      project(4, { status: "waiting", reviewOn: "2026-10-05", nextAction: null, actions: [] }),
      project(5, { status: "on_hold", reviewOn: "2026-10-30", nextAction: null, actions: [] }),
      project(6, { status: "completed" }),
      project(7, { targetOn: "2026-10-31" }),
    ],
  }, TODAY);
  assert.deepEqual(rows.map((row) => [row.project.id, row.attention]), [
    [2, "overdue"], [3, "missing"], [4, "review"], [7, null], [1, null],
  ]);
});

test("Project section offers the queued action or a new one when completing", () => {
  const queued = { id: 99, content: "参考書購入", status: "queued" as const, completedAt: null, updatedAt: "2026-09-23T00:00:00.000Z" };
  const data = { projects: [project(1, { targetOn: "2027-01-24", actions: [project(1).nextAction!, queued] })] };
  const closed = renderProjectSection({ status: "ready", data, error: null }, { now: NOW });
  assert.match(closed, /Project 1 · あと111日/);
  assert.match(closed, /data-project-resolve="10"/);
  assert.doesNotMatch(closed, /today-resolver/);
  const open = renderProjectSection({ status: "ready", data, error: null }, { resolvingActionId: 10, now: NOW });
  assert.match(open, /data-project-continue="10" data-queued-id="99">完了して「参考書購入」へ進む/);
  assert.match(open, /data-project-next="10"/);
  assert.match(open, /href="\/projects\/\?id=1">待ち・保留・Project完了はProjectsで/);
});

test("ToDo section offers bulk review, links rows to Idea and escapes titles", () => {
  const items = [1, 2, 3, 4, 5].map((id) => todo(id, `2026-09-2${id}`, { title: id === 5 ? "<b>買う</b>" : `ToDo ${id}` }));
  const html = renderTodoSection({ status: "ready", data: { items }, error: null }, { now: NOW });
  assert.match(html, /期限切れ 5件/);
  assert.match(html, /id="todayTriageButton">まとめて見直す/);
  assert.equal((html.match(/data-todo-complete=/g) || []).length, 3);
  assert.match(html, /あと2件を表示/);
  assert.match(html, /href="\/compass\/\?view=todos&amp;id=5"/);
  assert.match(html, /&lt;b&gt;買う&lt;\/b&gt;/);
  const all = renderTodoSection({ status: "ready", data: { items }, error: null }, { now: NOW, showAll: true });
  assert.equal((all.match(/data-todo-complete=/g) || []).length, 5);
  const none = renderTodoSection({ status: "ready", data: { items: [todo(9, "2026-12-23")] }, error: null }, { now: NOW });
  assert.match(none, /期限切れはありません/);
  assert.match(none, /次は 12\/23（水） ToDo 9/);
});

test("each section reports its own loading and failure with a retry", () => {
  assert.match(renderTodoSection({ status: "loading", data: null, error: null }), /ToDoを読み込んでいます/);
  assert.match(renderHabitSection({ status: "error", data: null, error: "接続できませんでした" }), /data-today-retry="habits"/);
  assert.match(renderProjectSection({ status: "error", data: null, error: null }), /Projectを取得できませんでした/);
});

test("today's completed count adds ToDos, habits and project actions finished today (JST)", () => {
  const count = completedTodayCount({
    todos: { items: [
      todo(1, "2026-10-01", { status: "completed", completedAt: "2026-10-04T15:30:00Z" }),
      todo(2, "2026-10-01", { status: "completed", completedAt: "2026-10-04T14:00:00Z" }),
    ] },
    habits: { today: TODAY, habits: [habit(1, "daily", { completedToday: true }), habit(2, "daily")] },
    projects: { projects: [project(1, { actions: [{ id: 5, content: "done", status: "done", completedAt: "2026-10-05T01:00:00Z", updatedAt: "2026-10-05T01:00:00Z" }] })] },
  }, NOW);
  assert.equal(count, 3);
});
