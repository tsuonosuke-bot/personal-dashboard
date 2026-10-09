import assert from "node:assert/strict";
import test from "node:test";
import {
  completedTodayCount,
  groupTodos,
  habitGroups,
  habitLocked,
  habitNote,
  habitStreak,
  missedYesterday,
  projectRows,
  projectTasksDueToday,
  renderHabitSection,
  renderProjectSection,
  renderTodoSection,
  rescheduleRequest,
  todoPill,
  todoRequestBody,
  weekendDate,
  type TodayHabit,
  type TodayProject,
  type TodayProjectAction,
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
      // 平日のHabitは土日（10/3・10/4）が対象外
      habit(5, "weekdays", { eligibleToday: false, history: history([false, false, false, false, false, false, false], [true, true, true, true, false, false, true]) }),
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

function task(id: number, extra: Partial<TodayProjectAction> = {}): TodayProjectAction {
  return { id, content: `Task ${id}`, status: "queued", dueOn: null, startOn: null, completedAt: null, updatedAt: "2026-09-23T00:00:00.000Z", ...extra };
}

test("着手が必要: 期限超過・今日・3日以内・着手日到来・今やるのタスクだけを、Projectをまたいで期日順に集める (#154)", () => {
  const rows = projectRows({
    projects: [
      // 今やる（期日なし）と、期日が4日後で着手日も先の候補（出さない）
      project(1, { actions: [project(1).nextAction!, task(11, { dueOn: "2026-10-09", startOn: "2026-10-07" })] }),
      // 期限超過・今日が期日・3日以内・着手日到来の候補
      project(2, {
        targetOn: "2026-10-03",
        actions: [
          { ...project(2).nextAction!, dueOn: "2026-10-08" },
          task(21, { dueOn: "2026-10-01" }),
          task(22, { dueOn: TODAY }),
          task(23, { startOn: "2026-10-04" }),
          task(24),
        ],
      }),
      // 未完了のActionがない → 次の一手を決める
      project(3, { nextAction: null, actions: [task(31, { status: "done" })] }),
      project(4, { status: "waiting", reviewOn: "2026-10-05", nextAction: null, actions: [] }),
      project(5, { status: "on_hold", reviewOn: "2026-10-30", nextAction: null, actions: [] }),
      project(6, { status: "completed", actions: [task(61, { dueOn: "2026-10-01" })] }),
    ],
  }, TODAY);
  assert.deepEqual(rows.map((row) => [row.project.id, row.action?.id ?? null, row.reason]), [
    [2, 21, "overdue"],
    [4, null, "review"],
    [3, null, "missing"],
    [2, 22, "due_today"],
    [2, 20, "due_soon"],
    [2, 23, "started"],
    [1, 10, "pinned"],
  ]);
  // Next Actionを完了したときに進む候補は、自分を除いた残りの候補
  assert.deepEqual(rows.find((row) => row.action?.id === 20)?.queued.map((action) => action.id), [21, 22, 23, 24]);
});

test("着手が必要は5件まで見せ、残りは「あとN件を表示」で開く。日付の理由と今やるをピルで示す", () => {
  const actions = [
    { ...project(1).nextAction!, dueOn: "2026-10-07" },
    ...[1, 2, 3, 4, 5, 6].map((index) => task(100 + index, { dueOn: `2026-10-0${index}` })),
  ];
  const data = { projects: [project(1, { title: "<英語>", targetOn: "2026-10-01", actions })] };
  const html = renderProjectSection({ status: "ready", data, error: null }, { now: NOW });
  assert.equal((html.match(/data-project-task=/g) || []).length, 5);
  assert.match(html, /data-project-more>あと2件を表示/);
  assert.match(html, /期日10\/1を4日超過/);
  assert.match(html, /今日が期日/);
  assert.match(html, /&lt;英語&gt; · 目標日を過ぎています/);
  const all = renderProjectSection({ status: "ready", data, error: null }, { now: NOW, showAll: true });
  assert.equal((all.match(/data-project-task=/g) || []).length, 7);
  assert.doesNotMatch(all, /data-project-more/);
  assert.match(all, /期日まであと1日/);
  assert.match(all, /期日まであと2日<\/span><span class="today-pill project">今やる/);

  const started = renderProjectSection({ status: "ready", data: { projects: [project(2, { actions: [project(2).nextAction!, task(201, { startOn: TODAY })] })] }, error: null }, { now: NOW });
  assert.match(started, /今日から着手/);
  assert.match(started, /today-pill project">今やる/);
});

test("Next Actionの完了は、残りの候補がないときだけ次の一手を聞く", () => {
  const lone = { projects: [project(1)] };
  const closed = renderProjectSection({ status: "ready", data: lone, error: null }, { now: NOW });
  assert.match(closed, /data-project-task="10" aria-label="「Next 1」を完了" aria-expanded="false"/);
  assert.doesNotMatch(closed, /today-resolver/);
  const open = renderProjectSection({ status: "ready", data: lone, error: null }, { resolvingActionId: 10, now: NOW });
  assert.match(open, /data-project-next="10"/);
  assert.match(open, /href="\/projects\/\?id=1">待ち・保留・Project完了はProjectsで/);
  assert.doesNotMatch(open, /data-project-continue/);

  const withQueue = { projects: [project(1, { actions: [project(1).nextAction!, task(99)] })] };
  const html = renderProjectSection({ status: "ready", data: withQueue, error: null }, { now: NOW });
  assert.match(html, /data-project-task="10" aria-label="「Next 1」を完了">/);
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

test("期限超過・今日が期日のProjectタスクが残っている間は、今日の分を完了扱いにしない", () => {
  const data = { projects: [project(1, { actions: [{ ...project(1).nextAction!, dueOn: "2026-10-08" }, task(11, { dueOn: TODAY }), task(12, { dueOn: "2026-10-06" })] })] };
  assert.equal(projectTasksDueToday(data, TODAY), 1);
  assert.equal(projectTasksDueToday({ projects: [project(2)] }, TODAY), 0);
  assert.equal(projectTasksDueToday(null, TODAY), 0);
});

test("昨日が対象日で記録のない毎日・平日のHabitを「昨日の未記録」として出し、昨日分を記録するボタンを置く (#155)", () => {
  const yesterdayDone = history([false, false, false, false, false, true, false]);
  const payload = {
    today: TODAY,
    habits: [
      habit(1, "daily"),
      habit(2, "daily", { history: yesterdayDone }),
      habit(3, "weekdays"),
      habit(4, "weekdays", { history: history([false, false, false, false, false, false, false], [true, true, true, true, false, false, true]) }),
      habit(5, "weekly"),
      habit(6, "flexible"),
      habit(7, "daily", { status: "paused" }),
      habit(8, "daily", { name: "<読書>", history: history([false, false, false, false, false, false, false], [false, false, false, false, false, false, true]) }),
    ],
  };
  assert.deepEqual(missedYesterday(payload).map((item) => item.id), [1, 3]);
  assert.deepEqual(missedYesterday(null), []);
  const html = renderHabitSection({ status: "ready", data: payload, error: null });
  assert.match(html, /昨日の未記録 2件/);
  assert.match(html, /data-habit-backfill="1" aria-label="Habit 1を昨日の分として記録"/);
  assert.match(html, /data-habit-backfill="3"/);
  assert.doesNotMatch(html, /data-habit-backfill="(2|4|5|6|7|8)"/);
  const none = renderHabitSection({ status: "ready", data: { today: TODAY, habits: [habit(2, "daily", { history: yesterdayDone })] }, error: null });
  assert.doesNotMatch(none, /today-backfill/);
});
