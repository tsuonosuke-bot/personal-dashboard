// 今日やることのHTMLと読み込み・空・エラー表示。保存操作はcontrollerへ委ねる。
import { OVERDUE_PREVIEW, SOON_DAYS, todayInTokyo, daysBetween, shortDate, monthDay, todoTiming, groupTodos, scheduleLabel, isWeekly, missedYesterday, habitGroups, habitStreak, habitPressed, PROJECT_PREVIEW, projectRows, projectTasksDueToday, completedTodayCount } from "./model.js";
import { escapeHtml } from "../shared/html.js";
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

export function habitNote(habit, today) {
  if (isWeekly(habit)) {
    const target = habit.targetPerWeek || 1;
    const count = habit.weeklyCount ?? (habit.completedThisWeek ? 1 : 0);
    const progress = `今週 ${count}/${target}回${count >= target ? " 達成" : ""}`;
    if (habit.completedToday) return `${progress} · 今日 記録済み`;
    if (habit.skippedToday) return `${progress} · 今日は休み`;
    return habit.skippedThisWeek && count < target ? `${progress} · 休みの週` : progress;
  }
  if (habit.skippedToday) return "今日は休み";
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

// ---------- 描画 ----------

export const CHECK = '<span class="today-check-mark" aria-hidden="true">✓</span>';

export function sectionState(section, label, retryKey) {
  if (section.status === "loading" && !section.data) return `<p class="today-quiet" role="status">${label}を読み込んでいます…</p>`;
  if (section.status === "error" && !section.data) {
    return `<div class="today-error" role="alert"><span>${escapeHtml(section.error || `${label}を取得できませんでした。`)}</span><button type="button" data-today-retry="${retryKey}">再試行</button></div>`;
  }
  return null;
}

export function todoRow(item, compassUrl, now) {
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

export function habitChip(habit, today) {
  const pressed = habitPressed(habit);
  return `<button class="today-chip" type="button" data-habit-toggle="${habit.id}" aria-pressed="${pressed}">
    <span class="today-chip-dot" aria-hidden="true">✓</span>
    <span><b>${escapeHtml(habit.name)}</b><small>${escapeHtml(habitNote(habit, today))}</small></span>
  </button>`;
}

/** 月曜だけ、先週（月〜日）の結果をHubの先頭に出す（#163）。 */
export function lastWeekCard(payload) {
  const today = payload?.today;
  const habits = payload?.lastWeek?.habits || [];
  if (!today || new Date(`${today}T00:00:00Z`).getUTCDay() !== 1 || !habits.length) return "";
  const counted = habits.filter((habit) => habit.achieved !== null);
  const achieved = counted.filter((habit) => habit.achieved).length;
  const items = habits.map((habit) => {
    const value = `${habit.target === null ? `${habit.done}${habit.unit}` : `${habit.done}/${habit.target}${habit.unit}`}${habit.skipped ? ` · 休${habit.skipped}` : ""}`;
    return `<li${habit.achieved ? ' class="done"' : ""}><span>${escapeHtml(habit.name)}</span><b>${value}</b></li>`;
  }).join("");
  return `<div class="today-last-week"><b>先週の結果 · 目標達成 ${achieved}/${counted.length}</b><ul>${items}</ul></div>`;
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
  let html = lastWeekCard(payload);
  const missed = missedYesterday(payload);
  if (missed.length) {
    html += `<div class="today-backfill"><b>昨日の未記録 ${missed.length}件</b><div class="today-backfill-chips">${missed.map((habit) =>
      `<span class="today-backfill-item"><button type="button" data-habit-backfill="${habit.id}" aria-label="${escapeHtml(habit.name)}を昨日の分として記録"><span aria-hidden="true">＋</span>${escapeHtml(habit.name)}</button><button class="rest" type="button" data-habit-backfill-skip="${habit.id}" aria-label="${escapeHtml(habit.name)}は昨日休んだ">休んだ</button></span>`).join("")}</div></div>`;
  }
  if (groups.daily.length) {
    const ratio = groups.dailyTarget ? Math.round((groups.dailyDone / groups.dailyTarget) * 100) : 100;
    html += `<div class="today-progress"><span>今日 ${groups.dailyDone}/${groups.dailyTarget}</span><i role="progressbar" aria-label="今日の習慣" aria-valuemin="0" aria-valuemax="${groups.dailyTarget}" aria-valuenow="${groups.dailyDone}"><b style="width:${ratio}%"></b></i></div>`;
    html += `<div class="today-chips">${groups.daily.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  if (groups.weekly.length) {
    html += `<p class="today-group">今週の目標 · 達成 ${groups.weeklyDone}/${groups.weeklyTarget}</p>`;
    html += `<div class="today-chips">${groups.weekly.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  if (groups.flexible.length) {
    html += `<p class="today-group">いつでも</p><div class="today-chips">${groups.flexible.map((habit) => habitChip(habit, today)).join("")}</div>`;
  }
  return html;
}

export function taskPill(row, today) {
  const { action } = row;
  switch (row.reason) {
    case "overdue":
      return `<span class="today-pill attention">期日${escapeHtml(monthDay(action.dueOn))}を${daysBetween(action.dueOn, today)}日超過</span>`;
    case "due_today":
      return `<span class="today-pill attention">今日が期日</span>`;
    case "due_soon":
      return `<span class="today-pill soon">期日まであと${daysBetween(today, action.dueOn)}日</span>`;
    case "started":
      return `<span class="today-pill project">${action.startOn === today ? "今日から着手" : `着手日${escapeHtml(monthDay(action.startOn))}から`}</span>`;
    default:
      return `<span class="today-pill project">今やる</span>`;
  }
}

export function projectMeta(row, today) {
  const { project } = row;
  const targetPassed = project.targetOn && project.targetOn < today ? " · 目標日を過ぎています" : "";
  // タスクがマイルストンに属していれば、その名前を添える（#161）
  const milestone = row.action?.milestoneId ? (project.milestones || []).find((candidate) => candidate.id === row.action.milestoneId) : null;
  const milestoneLabel = milestone ? ` · ${escapeHtml(milestone.title)}` : "";
  const title = `<span>${escapeHtml(project.title)}${milestoneLabel}${targetPassed}</span>`;
  if (row.kind === "review") return `<span class="today-pill attention">見直し日です</span>${title}`;
  // 14日以上動きのないProjectには、行に「N日動きなし」を添える（#162）
  const stale = project.stale && project.lastActivityAt
    ? `<span class="today-pill attention">${daysBetween(todayInTokyo(new Date(project.lastActivityAt)), today)}日動きなし</span>` : "";
  if (row.kind === "missing") return `<span class="today-pill attention">次の一手が未設定</span>${stale}${title}`;
  const pinned = row.action.status === "next" && row.reason !== "pinned" ? `<span class="today-pill project">今やる</span>` : "";
  return `${taskPill(row, today)}${pinned}${stale}${title}`;
}

/** Next Actionを完了したあと、残りのタスクがないときだけ次の一手を決める（#154）。 */
export function projectResolver(row) {
  const id = row.action.id;
  return `<div class="today-resolver">
    <form class="today-next-form" data-project-next="${id}">
      <input name="content" maxlength="500" required aria-label="${escapeHtml(row.project.title)}の次の一手" placeholder="次の一手は？">
      <button type="submit">完了して設定</button>
    </form>
    <div class="today-resolver-foot"><button type="button" data-project-cancel>やめる</button><a href="/projects/?id=${row.project.id}">待ち・保留・Project完了はProjectsで →</a></div>
  </div>`;
}

export function projectRow(row, today, resolvingActionId) {
  const { project, action } = row;
  const projectUrl = `/projects/?id=${project.id}`;
  const resolving = action && action.id === resolvingActionId;
  const check = action
    ? `<button class="today-check${resolving ? " is-on" : ""}" type="button" data-project-task="${action.id}" aria-label="「${escapeHtml(action.content)}」を完了"${action.status === "next" && !row.queued.length ? ` aria-expanded="${Boolean(resolving)}"` : ""}>${CHECK}</button>`
    : `<span class="today-check-spacer" aria-hidden="true"></span>`;
  const title = action
    ? `<a class="today-row-title" href="${projectUrl}">${escapeHtml(action.content)}</a>`
    : `<a class="today-row-title" href="${projectUrl}">${row.kind === "missing" ? "Projectsで次の一手を決める →" : "Projectsで状況を見直す →"}</a>`;
  const attention = ["overdue", "due_today", "missing", "review"].includes(row.reason);
  return `<li class="today-row today-project-row">
      ${check}
      <div class="today-next-action${attention ? " attention" : ""}">
        ${title}
        <div class="today-row-meta">${projectMeta(row, today)}</div>
        ${resolving ? projectResolver(row) : ""}
      </div>
    </li>`;
}

export function renderProjectSection(section, { resolvingActionId = null, showAll = false, now = new Date() } = {}) {
  const fallback = sectionState(section, "Project", "projects");
  if (fallback) return fallback;
  const today = todayInTokyo(now);
  const rows = projectRows(section.data, today);
  if (!rows.length) return `<p class="today-quiet">進行中のProjectはありません。</p>`;
  const shown = showAll ? rows : rows.slice(0, PROJECT_PREVIEW);
  let html = `<ul class="today-list today-projects">${shown.map((row) => projectRow(row, today, resolvingActionId)).join("")}</ul>`;
  if (shown.length < rows.length) {
    html += `<button class="today-more" type="button" data-project-more>あと${rows.length - shown.length}件を表示</button>`;
  }
  return html;
}

export function createTodayView({ state, els }) {
  function render() {
    const now = new Date();
    els.todos.innerHTML = renderTodoSection(state.todos, { compassUrl: state.compassUrl, showAll: state.showAllTodos, now });
    els.habits.innerHTML = renderHabitSection(state.habits);
    els.projects.innerHTML = renderProjectSection(state.projects, { resolvingActionId: state.resolvingActionId, showAll: state.showAllProjects, now });
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
    const allDone = groups.overdue.length === 0 && groups.today.length === 0 && habits.dailyDone >= habits.dailyTarget
      && projectTasksDueToday(state.projects.data, todayInTokyo(now)) === 0;
    els.allDone.hidden = !allDone;
    if (allDone) {
      const weeklyLeft = habits.weeklyTarget - habits.weeklyDone;
      els.allDone.innerHTML = `<span aria-hidden="true">✓</span><div>今日の分はすべて完了しました<small>${count}件こなしました。${weeklyLeft > 0 ? `今週の習慣はあと${weeklyLeft}つです。` : "今週の習慣も完了です。"}</small></div>`;
    }
  }
  return { render };
}
