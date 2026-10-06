// 「今日やること」: ToDo・Habit・Projectの次の一手をHubに集め、その場で完了できるようにする。
// 書き込みは各ページと同じAPI（/api/scheduled-actions・/api/habit-logs・/api/project-actions）を使う。
import { readApiJson } from "./api-client.js";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const OVERDUE_PREVIEW = 3;
export const SOON_DAYS = 7;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function todayInTokyo(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 次の土曜日。土日に開いたときは翌週の土曜日にする（「今日」「明日」と重ならないように）。 */
export function weekendDate(today) {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, day === 6 ? 7 : day === 0 ? 6 : 6 - day);
}

export function shortDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}（${WEEKDAYS[parsed.getUTCDay()]}）`;
}

function monthDay(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

// ---------- ToDo ----------

/** Idea画面の todoTiming と同じ判定。Calendar予定が無い・取消済みのものも確認待ちに入れる。 */
export function todoTiming(item, now = new Date()) {
  if (item.calendarState === "missing" || item.calendarState === "cancelled") return "overdue";
  const schedule = item.schedule;
  if (!schedule?.date) return "overdue";
  const today = todayInTokyo(now);
  if (schedule.date < today) return "overdue";
  if (schedule.date > today) return "upcoming";
  if (schedule.allDay) return "today";
  const end = new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime() ? "overdue" : "today";
}

function scheduleKey(item) {
  return `${item.schedule?.date || "9999-12-31"}T${item.schedule?.startTime || "00:00"}`;
}

export function groupTodos(items, now = new Date()) {
  const today = todayInTokyo(now);
  const groups = { overdue: [], today: [], soon: [], next: null };
  const later = [];
  for (const item of items || []) {
    if (item.status !== "pending") continue;
    const timing = todoTiming(item, now);
    if (timing === "overdue") groups.overdue.push(item);
    else if (timing === "today") groups.today.push(item);
    else if (daysBetween(today, item.schedule.date) <= SOON_DAYS) groups.soon.push(item);
    else later.push(item);
  }
  const ascending = (left, right) => scheduleKey(left).localeCompare(scheduleKey(right)) || left.id - right.id;
  // 期限切れは直近のものから。古いものほど「まとめて見直す」で拾う。
  groups.overdue.sort((left, right) => ascending(right, left));
  groups.today.sort(ascending);
  groups.soon.sort(ascending);
  groups.next = later.sort(ascending)[0] || null;
  return groups;
}

export function todoPill(item, now = new Date()) {
  if (item.calendarState === "missing") return { tone: "overdue", label: "Calendar予定なし" };
  if (item.calendarState === "cancelled") return { tone: "overdue", label: "Calendarで取消済み" };
  const today = todayInTokyo(now);
  const date = item.schedule?.date;
  if (!date) return { tone: "overdue", label: "日時未設定" };
  const timing = todoTiming(item, now);
  const difference = daysBetween(today, date);
  if (timing === "overdue") {
    if (difference === 0) return { tone: "overdue", label: "時間超過" };
    return { tone: "overdue", label: difference === -1 ? "昨日" : `${-difference}日超過` };
  }
  if (timing === "today") return { tone: "today", label: "今日" };
  return { tone: "upcoming", label: difference === 1 ? "明日" : `${difference}日後` };
}

export function scheduleLabel(schedule) {
  if (!schedule?.date) return "日時未設定";
  return schedule.allDay ? shortDate(schedule.date) : `${shortDate(schedule.date)} ${schedule.startTime}–${schedule.endTime}`;
}

const RESCHEDULE_OFFSETS = { today: 0, tomorrow: 1 };

/**
 * 見直しで日程を変えるときの送信内容。終日／時間指定は元の予定のまま日付だけ動かす。
 * Calendar予定が消えているものは再作成（recreate）、Calendarに接続できないときは変更しない。
 */
export function rescheduleRequest(item, choice, now = new Date()) {
  if (item.calendarState === "unavailable") {
    return { disabled: "Google Calendarに接続できないため、日程は変更できません。" };
  }
  const recreate = item.calendarState === "missing" || item.calendarState === "cancelled";
  if (!recreate && !item.calendarEtag) {
    return { disabled: "Google Calendarの最新状態を確認できないため、日程は変更できません。" };
  }
  const today = todayInTokyo(now);
  const date = choice === "weekend" ? weekendDate(today) : addDays(today, RESCHEDULE_OFFSETS[choice] ?? 0);
  const source = item.schedule || { allDay: true, startTime: null, endTime: null };
  const schedule = {
    allDay: Boolean(source.allDay),
    date,
    startTime: source.allDay ? null : source.startTime,
    endTime: source.allDay ? null : source.endTime,
    timeZone: "Asia/Tokyo",
  };
  const end = schedule.allDay
    ? new Date(`${date}T23:59:59+09:00`)
    : new Date(`${date}T${schedule.endTime}:00+09:00`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) {
    return { disabled: "予定の時間を過ぎているため、今日には移せません。" };
  }
  return { command: recreate ? "recreate" : "reschedule", schedule };
}

export function todoRequestBody(item, command, schedule = null) {
  return {
    id: item.id,
    command,
    note: item.note ?? null,
    schedule,
    original: {
      status: item.status,
      updatedAt: item.updatedAt,
      calendarEtag: item.calendarEtag,
      schedule: item.schedule,
    },
  };
}

// ---------- Habit ----------

function isWeekly(habit) {
  return habit.cadence === "weekly";
}

export function habitGroups(payload) {
  const today = payload?.today;
  const active = (payload?.habits || []).filter((habit) => habit.status === "active");
  const daily = active.filter((habit) => (habit.cadence === "daily" || habit.cadence === "weekdays") && habit.eligibleToday);
  const weekly = active.filter((habit) => isWeekly(habit) && (!today || today >= habit.startedOn));
  const flexible = active.filter((habit) => habit.cadence === "flexible" && habit.eligibleToday);
  return {
    daily,
    weekly,
    flexible,
    dailyDone: daily.filter((habit) => habit.completedToday).length,
    weeklyDone: weekly.filter((habit) => habit.completedThisWeek).length,
  };
}

/** 直近7日の履歴から、今日（未記録なら昨日）までの連続日数を数える。対象外の日は飛ばす。 */
export function habitStreak(habit) {
  const history = [...(habit.history || [])].sort((left, right) => left.date.localeCompare(right.date));
  let index = history.length - 1;
  if (index >= 0 && !history[index].completed) index -= 1;
  let streak = 0;
  for (; index >= 0; index -= 1) {
    const day = history[index];
    if (!day.eligible) continue;
    if (!day.completed) break;
    streak += 1;
  }
  return streak;
}

export function habitPressed(habit) {
  return isWeekly(habit) ? Boolean(habit.completedThisWeek) : Boolean(habit.completedToday);
}

/** 週1回の習慣を今日より前に記録済みなら、Hubからは取り消せない（APIが今日の記録しか消さない）。 */
export function habitLocked(habit, today) {
  return isWeekly(habit) && Boolean(habit.completedThisWeek) && habit.weeklyCompletedOn !== today;
}

export function habitNote(habit, today) {
  if (isWeekly(habit)) {
    if (!habit.completedThisWeek) return "今週まだ";
    return habit.weeklyCompletedOn === today ? "今週分を記録済み" : `今週分は${shortDate(habit.weeklyCompletedOn)}に記録済み`;
  }
  const streak = habitStreak(habit);
  const streakLabel = streak >= 7 ? "7日以上連続" : `${streak}日連続`;
  if (habit.completedToday) return streak >= 2 ? `今日 記録済み · ${streakLabel}` : "今日 記録済み";
  if (streak >= 2) return `${streakLabel}中`;
  const last = [...(habit.history || [])]
    .filter((day) => day.completed && day.date < today)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (!last) return "直近7日 記録なし";
  const difference = daysBetween(last.date, today);
  return difference === 1 ? "前回 昨日" : difference === 2 ? "前回 一昨日" : `前回 ${difference}日前`;
}

// ---------- Project ----------

export function projectRows(payload, today) {
  const rows = [];
  for (const project of payload?.projects || []) {
    if (project.status === "active") {
      const attention = !project.nextAction
        ? "missing"
        : project.targetOn && project.targetOn < today ? "overdue" : null;
      rows.push({
        project,
        kind: "next",
        attention,
        queued: (project.actions || []).filter((action) => action.status === "queued"),
      });
    } else if ((project.status === "waiting" || project.status === "on_hold") && project.reviewOn && project.reviewOn <= today) {
      rows.push({ project, kind: "review", attention: "review", queued: [] });
    }
  }
  return rows.sort((left, right) => {
    if (Boolean(left.attention) !== Boolean(right.attention)) return left.attention ? -1 : 1;
    const leftTarget = left.project.targetOn || "9999-12-31";
    const rightTarget = right.project.targetOn || "9999-12-31";
    return leftTarget.localeCompare(rightTarget) || left.project.id - right.project.id;
  });
}

// ---------- 今日の完了数 ----------

function completedOn(value, today) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false;
  return todayInTokyo(new Date(value)) === today;
}

export function completedTodayCount({ todos, habits, projects }, now = new Date()) {
  const today = todayInTokyo(now);
  const todoCount = (todos?.items || []).filter((item) => item.status === "completed" && completedOn(item.completedAt, today)).length;
  const habitCount = (habits?.habits || []).filter((habit) => habit.status === "active" && habit.completedToday).length;
  const projectCount = (projects?.projects || [])
    .flatMap((project) => project.actions || [])
    .filter((action) => action.status === "done" && completedOn(action.completedAt, today)).length;
  return todoCount + habitCount + projectCount;
}

// ---------- 描画 ----------

const CHECK = '<span class="today-check-mark" aria-hidden="true">✓</span>';

function sectionState(section, label, retryKey) {
  if (section.status === "loading" && !section.data) return `<p class="today-quiet" role="status">${label}を読み込んでいます…</p>`;
  if (section.status === "error" && !section.data) {
    return `<div class="today-error" role="alert"><span>${escapeHtml(section.error || `${label}を取得できませんでした。`)}</span><button type="button" data-today-retry="${retryKey}">再試行</button></div>`;
  }
  return null;
}

function todoRow(item, compassUrl, now) {
  const pill = todoPill(item, now);
  const href = `${compassUrl}?view=todos&id=${encodeURIComponent(item.id)}`;
  return `<li class="today-row">
    <button class="today-check" type="button" data-todo-complete="${item.id}" aria-label="「${escapeHtml(item.title)}」を完了">${CHECK}</button>
    <div class="today-row-body">
      <a class="today-row-title" href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>
      <div class="today-row-meta"><span class="today-pill ${pill.tone}">${escapeHtml(pill.label)}</span><span>${escapeHtml(scheduleLabel(item.schedule))}</span></div>
    </div>
  </li>`;
}

export function renderTodoSection(section, { compassUrl = "/compass/", showAll = false, now = new Date() } = {}) {
  const fallback = sectionState(section, "ToDo", "todos");
  if (fallback) return fallback;
  const groups = groupTodos(section.data?.items, now);
  let html = "";
  if (groups.overdue.length) {
    const shown = showAll ? groups.overdue : groups.overdue.slice(0, OVERDUE_PREVIEW);
    html += `<div class="today-triage"><b>期限切れ ${groups.overdue.length}件</b><button type="button" id="todayTriageButton">まとめて見直す</button></div>`;
    html += `<ul class="today-list">${shown.map((item) => todoRow(item, compassUrl, now)).join("")}</ul>`;
    if (shown.length < groups.overdue.length) {
      html += `<button class="today-more" type="button" data-todo-more>あと${groups.overdue.length - shown.length}件を表示</button>`;
    }
  } else {
    html += `<p class="today-ok">✓ 期限切れはありません</p>`;
  }
  if (groups.today.length) html += `<p class="today-group">今日</p><ul class="today-list">${groups.today.map((item) => todoRow(item, compassUrl, now)).join("")}</ul>`;
  if (groups.soon.length) html += `<p class="today-group">${SOON_DAYS}日以内</p><ul class="today-list">${groups.soon.map((item) => todoRow(item, compassUrl, now)).join("")}</ul>`;
  if (!groups.today.length && !groups.soon.length) {
    const next = groups.next ? `<br>次は ${escapeHtml(shortDate(groups.next.schedule.date))} ${escapeHtml(groups.next.title)}` : "";
    html += `<p class="today-quiet">${SOON_DAYS}日以内の予定はありません${next}</p>`;
  }
  return html;
}

function habitChip(habit, today) {
  const pressed = habitPressed(habit);
  const locked = habitLocked(habit, today);
  return `<button class="today-chip" type="button" data-habit-toggle="${habit.id}" aria-pressed="${pressed}"${locked ? " disabled" : ""}>
    <span class="today-chip-dot" aria-hidden="true">✓</span>
    <span><b>${escapeHtml(habit.name)}</b><small>${escapeHtml(habitNote(habit, today))}</small></span>
  </button>`;
}

export function renderHabitSection(section) {
  const fallback = sectionState(section, "Habit", "habits");
  if (fallback) return fallback;
  const payload = section.data;
  const today = payload.today;
  const groups = habitGroups(payload);
  if (!groups.daily.length && !groups.weekly.length && !groups.flexible.length) {
    return `<p class="today-quiet">続けている習慣はまだありません。Habitsで追加できます。</p>`;
  }
  let html = "";
  if (groups.daily.length) {
    const ratio = Math.round((groups.dailyDone / groups.daily.length) * 100);
    html += `<div class="today-progress"><span>今日 ${groups.dailyDone}/${groups.daily.length}</span><i role="progressbar" aria-label="今日の習慣" aria-valuemin="0" aria-valuemax="${groups.daily.length}" aria-valuenow="${groups.dailyDone}"><b style="width:${ratio}%"></b></i></div>`;
    html += `<div class="today-chips">${groups.daily.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  if (groups.weekly.length) {
    html += `<p class="today-group">今週（週1回）· ${groups.weeklyDone}/${groups.weekly.length}</p>`;
    html += `<div class="today-chips">${groups.weekly.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  if (groups.flexible.length) {
    html += `<p class="today-group">いつでも</p><div class="today-chips">${groups.flexible.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  return html;
}

function projectMeta(row, today) {
  const { project } = row;
  const title = `<span>${escapeHtml(project.title)}</span>`;
  if (row.kind === "review") return `${title}<span class="today-pill attention">見直し日です</span>`;
  if (row.attention === "missing") return `<span class="today-pill attention">次の一手が未設定</span>${title}`;
  if (row.attention === "overdue") {
    return `${title}<span class="today-pill attention">目標日${escapeHtml(monthDay(project.targetOn))}を${daysBetween(project.targetOn, today)}日過ぎています</span>`;
  }
  return project.targetOn ? `<span>${escapeHtml(project.title)} · あと${daysBetween(today, project.targetOn)}日</span>` : title;
}

function projectResolver(row) {
  const next = row.queued[0];
  const id = row.project.nextAction.id;
  return `<div class="today-resolver">
    ${next ? `<button class="today-resolver-primary" type="button" data-project-continue="${id}" data-queued-id="${next.id}">完了して「${escapeHtml(next.content)}」へ進む</button>` : ""}
    <form class="today-next-form" data-project-next="${id}">
      <input name="content" maxlength="500" required aria-label="${escapeHtml(row.project.title)}の次の一手" placeholder="${next ? "別の次の一手を入力" : "次の一手は？"}">
      <button type="submit">完了して設定</button>
    </form>
    <div class="today-resolver-foot"><button type="button" data-project-cancel>やめる</button><a href="/projects/?id=${row.project.id}">待ち・保留・Project完了はProjectsで →</a></div>
  </div>`;
}

export function renderProjectSection(section, { resolvingActionId = null, now = new Date() } = {}) {
  const fallback = sectionState(section, "Project", "projects");
  if (fallback) return fallback;
  const today = todayInTokyo(now);
  const rows = projectRows(section.data, today);
  if (!rows.length) return `<p class="today-quiet">進行中のProjectはありません。</p>`;
  return `<ul class="today-list today-projects">${rows.map((row) => {
    const { project } = row;
    const projectUrl = `/projects/?id=${project.id}`;
    const action = row.kind === "next" ? project.nextAction : null;
    const missing = row.kind === "next" && !action;
    const resolving = action && action.id === resolvingActionId;
    const check = action
      ? `<button class="today-check${resolving ? " is-on" : ""}" type="button" data-project-resolve="${action.id}" aria-label="「${escapeHtml(action.content)}」を完了" aria-expanded="${Boolean(resolving)}">${CHECK}</button>`
      : `<span class="today-check-spacer" aria-hidden="true"></span>`;
    const title = action
      ? `<a class="today-row-title" href="${projectUrl}">${escapeHtml(action.content)}</a>`
      : `<a class="today-row-title" href="${projectUrl}">${missing ? "Projectsで次の一手を決める →" : "Projectsで状況を見直す →"}</a>`;
    return `<li class="today-row today-project-row">
      ${check}
      <div class="today-next-action${row.attention ? " attention" : ""}">
        ${title}
        <div class="today-row-meta">${projectMeta(row, today)}</div>
        ${resolving ? projectResolver(row) : ""}
      </div>
    </li>`;
  }).join("")}</ul>`;
}

// ---------- 画面の制御 ----------

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init.headers || {}) },
  });
  const payload = await readApiJson(response);
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || "処理を完了できませんでした。再試行してください。");
  }
  return payload;
}

function sendJson(url, method, action, body) {
  return requestJson(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Dashboard-Action": action },
    body: JSON.stringify(body),
  });
}

const SOURCES = {
  todos: { url: "/api/scheduled-actions", label: "ToDo" },
  habits: { url: "/api/habits", label: "Habit" },
  projects: { url: "/api/projects", label: "Project" },
};

export function createTodayPanel(root) {
  const $ = (id) => document.getElementById(id);
  const els = {
    counter: $("todayDoneCounter"),
    allDone: $("todayAllDone"),
    todos: $("todayTodos"),
    habits: $("todayHabits"),
    projects: $("todayProjects"),
    todoLink: $("todayTodoLink"),
    sheet: $("todaySheet"),
    sheetStep: $("todaySheetStep"),
    sheetBar: $("todaySheetBar"),
    sheetTitle: $("todaySheetTitle"),
    sheetMeta: $("todaySheetMeta"),
    sheetNotice: $("todaySheetNotice"),
    sheetActions: $("todaySheetActions"),
    sheetClose: $("todaySheetClose"),
    toast: $("todayToast"),
    toastText: $("todayToastText"),
    toastUndo: $("todayToastUndo"),
  };
  const state = {
    todos: { status: "loading", data: null, error: null },
    habits: { status: "loading", data: null, error: null },
    projects: { status: "loading", data: null, error: null },
    compassUrl: "/compass/",
    showAllTodos: false,
    resolvingActionId: null,
    triage: null,
  };
  let toastTimer = null;
  let undoAction = null;

  function render() {
    const now = new Date();
    els.todos.innerHTML = renderTodoSection(state.todos, { compassUrl: state.compassUrl, showAll: state.showAllTodos, now });
    els.habits.innerHTML = renderHabitSection(state.habits);
    els.projects.innerHTML = renderProjectSection(state.projects, { resolvingActionId: state.resolvingActionId, now });
    renderHeader(now);
  }

  function renderHeader(now) {
    const loaded = state.todos.data && state.habits.data && state.projects.data;
    const count = completedTodayCount({ todos: state.todos.data, habits: state.habits.data, projects: state.projects.data }, now);
    els.counter.hidden = !loaded;
    els.counter.textContent = `✓ 今日 ${count}件完了`;
    if (!state.todos.data || !state.habits.data) {
      els.allDone.hidden = true;
      return;
    }
    const groups = groupTodos(state.todos.data.items, now);
    const habits = habitGroups(state.habits.data);
    const allDone = groups.overdue.length === 0 && groups.today.length === 0 && habits.dailyDone === habits.daily.length;
    els.allDone.hidden = !allDone;
    if (allDone) {
      const weeklyLeft = habits.weekly.length - habits.weeklyDone;
      els.allDone.innerHTML = `<span aria-hidden="true">✓</span><div>今日の分はすべて完了しました<small>${count}件こなしました。${weeklyLeft > 0 ? `今週の習慣はあと${weeklyLeft}つです。` : "今週の習慣も完了です。"}</small></div>`;
    }
  }

  async function load(key) {
    state[key] = { ...state[key], status: "loading" };
    if (!state[key].data) render();
    try {
      const data = await requestJson(SOURCES[key].url);
      state[key] = { status: "ready", data, error: null };
    } catch (error) {
      state[key] = { status: "error", data: state[key].data, error: error instanceof Error ? error.message : `${SOURCES[key].label}を取得できませんでした。` };
      if (state[key].data) showToast(`${SOURCES[key].label}を最新にできませんでした。`);
    }
    render();
  }

  function loadAll() {
    return Promise.all(Object.keys(SOURCES).map(load));
  }

  function showToast(message, undo = null) {
    els.toastText.textContent = message;
    undoAction = undo;
    els.toastUndo.hidden = !undo;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { els.toast.hidden = true; undoAction = null; }, undo ? 6000 : 4000);
  }

  function findTodo(id) {
    return state.todos.data?.items?.find((item) => item.id === id) || null;
  }

  function updateTodo(item, command, schedule = null) {
    return sendJson("/api/scheduled-actions", "PATCH", "scheduled-todo-update", todoRequestBody(item, command, schedule));
  }

  async function completeTodo(id, button) {
    const item = findTodo(id);
    if (!item) return;
    button.disabled = true;
    button.classList.add("is-on");
    try {
      await updateTodo(item, "complete");
      await load("todos");
      showToast(`「${item.title}」を完了にしました`, async () => {
        const fresh = findTodo(id);
        if (!fresh || fresh.status !== "completed") throw new Error("ToDoの最新状態を確認できませんでした。");
        await updateTodo(fresh, "reopen");
        await load("todos");
        return "ToDoを未実施に戻しました";
      });
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-on");
      showToast(error instanceof Error ? error.message : "ToDoを完了にできませんでした。");
    }
  }

  async function setHabit(habit, completed) {
    await sendJson("/api/habit-logs", "PATCH", "habit-log", { habitId: habit.id, practicedOn: state.habits.data.today, completed });
  }

  async function toggleHabit(id, button) {
    const habit = state.habits.data?.habits?.find((candidate) => candidate.id === id);
    if (!habit) return;
    const completed = !habitPressed(habit);
    button.disabled = true;
    button.setAttribute("aria-pressed", String(completed));
    try {
      await setHabit(habit, completed);
      await load("habits");
      showToast(completed ? `${habit.name} を記録しました` : `${habit.name} の記録を取り消しました`, completed
        ? async () => {
          await setHabit(habit, false);
          await load("habits");
          return `${habit.name} の記録を取り消しました`;
        }
        : null);
    } catch (error) {
      button.disabled = false;
      button.setAttribute("aria-pressed", String(!completed));
      showToast(error instanceof Error ? error.message : "Habitを記録できませんでした。");
    }
  }

  function findProjectAction(actionId) {
    for (const project of state.projects.data?.projects || []) {
      if (project.nextAction?.id === actionId) return { project, action: project.nextAction };
    }
    return null;
  }

  async function resolveProject(actionId, { nextActionId = null, nextActionContent = null }, control) {
    const found = findProjectAction(actionId);
    if (!found) return;
    const controls = root.querySelectorAll(".today-resolver button, .today-resolver input");
    controls.forEach((element) => { element.disabled = true; });
    try {
      const payload = await sendJson("/api/project-actions", "PATCH", "project-action-resolve", {
        actionId,
        originalUpdatedAt: found.action.updatedAt,
        resolution: "continue",
        nextActionId,
        nextActionContent,
        waitingFor: null,
        reviewOn: null,
      });
      state.projects = { status: "ready", data: payload, error: null };
      state.resolvingActionId = null;
      render();
      const next = nextActionContent || found.project.actions.find((action) => action.id === nextActionId)?.content || "";
      showToast(`「${found.action.content}」を完了。次の一手は「${next}」です`);
    } catch (error) {
      controls.forEach((element) => { element.disabled = false; });
      control?.focus();
      showToast(error instanceof Error ? error.message : "Projectを更新できませんでした。");
    }
  }

  // ---------- 期限切れの見直し ----------

  function openTriage(trigger) {
    const overdue = groupTodos(state.todos.data?.items).overdue;
    if (!overdue.length) return;
    // 古いものから順に決める。
    const ids = [...overdue].reverse().map((item) => item.id);
    state.triage = { ids, index: 0, trigger, results: { done: 0, moved: 0, skipped: 0, later: 0 }, changed: false };
    els.sheet.hidden = false;
    document.body.classList.add("modal-open");
    showTriageStep();
  }

  function showTriageStep() {
    const triage = state.triage;
    const item = findTodo(triage.ids[triage.index]);
    if (!item) {
      nextTriageStep();
      return;
    }
    const now = new Date();
    const pill = todoPill(item, now);
    const today = todayInTokyo(now);
    els.sheetStep.textContent = `期限切れの見直し ${triage.index + 1} / ${triage.ids.length}`;
    els.sheetBar.style.width = `${(triage.index / triage.ids.length) * 100}%`;
    els.sheetTitle.textContent = item.title;
    els.sheetMeta.innerHTML = `<span class="today-pill ${pill.tone}">${escapeHtml(pill.label)}</span><span>予定 ${escapeHtml(scheduleLabel(item.schedule))}</span>`;
    const options = {
      today: rescheduleRequest(item, "today", now),
      tomorrow: rescheduleRequest(item, "tomorrow", now),
      weekend: rescheduleRequest(item, "weekend", now),
    };
    const notice = Object.values(options).find((option) => option.disabled)?.disabled || "";
    els.sheetNotice.textContent = notice;
    els.sheetNotice.hidden = !notice;
    const dateButton = (key, label, date) => `<button type="button" data-triage="${key}"${options[key].disabled ? " disabled" : ""}>${label}${date ? `<small>${escapeHtml(shortDate(date))}</small>` : ""}</button>`;
    els.sheetActions.innerHTML = `
      <button class="primary" type="button" data-triage="complete">やった（完了にする）</button>
      ${dateButton("today", "今日やる", null)}
      ${dateButton("tomorrow", "明日", addDays(today, 1))}
      ${dateButton("weekend", "週末", weekendDate(today))}
      <button type="button" data-triage="skip">やめる<small>見送りにする</small></button>
      <button class="subtle" type="button" data-triage="later">あとで決める</button>`;
    els.sheetActions.querySelector(".primary").focus();
  }

  function nextTriageStep() {
    state.triage.index += 1;
    if (state.triage.index >= state.triage.ids.length) closeTriage();
    else showTriageStep();
  }

  async function chooseTriage(choice) {
    const triage = state.triage;
    const item = findTodo(triage.ids[triage.index]);
    if (!item) return;
    if (choice === "later") {
      triage.results.later += 1;
      nextTriageStep();
      return;
    }
    const buttons = els.sheetActions.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    els.sheetNotice.hidden = true;
    try {
      if (choice === "complete" || choice === "skip") {
        await updateTodo(item, choice);
        triage.results[choice === "complete" ? "done" : "skipped"] += 1;
      } else {
        const request = rescheduleRequest(item, choice);
        if (request.disabled) throw new Error(request.disabled);
        await updateTodo(item, request.command, request.schedule);
        triage.results.moved += 1;
      }
      triage.changed = true;
      nextTriageStep();
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      els.sheetNotice.textContent = error instanceof Error ? error.message : "ToDoを更新できませんでした。";
      els.sheetNotice.hidden = false;
    }
  }

  function closeTriage() {
    const triage = state.triage;
    if (!triage) return;
    state.triage = null;
    els.sheet.hidden = true;
    document.body.classList.remove("modal-open");
    if (triage.trigger?.isConnected) triage.trigger.focus();
    const { done, moved, skipped } = triage.results;
    if (triage.changed) {
      void load("todos");
      showToast(`見直しました：完了${done}・日程変更${moved}・見送り${skipped}`);
    }
  }

  // ---------- イベント ----------

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.todoComplete) void completeTodo(Number(button.dataset.todoComplete), button);
    else if (button.dataset.habitToggle) void toggleHabit(Number(button.dataset.habitToggle), button);
    else if (button.dataset.projectResolve) {
      const actionId = Number(button.dataset.projectResolve);
      state.resolvingActionId = state.resolvingActionId === actionId ? null : actionId;
      render();
      if (state.resolvingActionId) root.querySelector(".today-resolver button, .today-resolver input")?.focus();
    } else if (button.dataset.projectContinue) {
      void resolveProject(Number(button.dataset.projectContinue), { nextActionId: Number(button.dataset.queuedId) }, button);
    } else if ("projectCancel" in button.dataset) {
      const actionId = state.resolvingActionId;
      state.resolvingActionId = null;
      render();
      root.querySelector(`[data-project-resolve="${actionId}"]`)?.focus();
    } else if ("todoMore" in button.dataset) {
      state.showAllTodos = true;
      render();
    } else if (button.id === "todayTriageButton") openTriage(button);
    else if (button.dataset.todayRetry) void load(button.dataset.todayRetry);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.dataset.projectNext) return;
    event.preventDefault();
    const content = form.elements.content.value.trim();
    if (!content) return;
    void resolveProject(Number(form.dataset.projectNext), { nextActionContent: content }, form.elements.content);
  });

  els.sheetActions.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-triage]") : null;
    if (button && !button.disabled) void chooseTriage(button.dataset.triage);
  });
  els.sheetClose.addEventListener("click", closeTriage);
  els.sheet.addEventListener("click", (event) => { if (event.target === els.sheet) closeTriage(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.triage) return;
    event.stopImmediatePropagation();
    closeTriage();
  });
  els.toastUndo.addEventListener("click", async () => {
    const undo = undoAction;
    undoAction = null;
    els.toast.hidden = true;
    if (!undo) return;
    try {
      showToast(await undo());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "取り消せませんでした。");
    }
  });

  return {
    load: loadAll,
    setNavigation(navigation) {
      state.compassUrl = navigation?.compass || "/compass/";
      els.todoLink.href = `${state.compassUrl}?view=todos`;
      render();
    },
    isOpen: () => Boolean(state.triage),
  };
}
