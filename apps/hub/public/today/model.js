// 日付・期限・習慣・Projectの表示用データを組み立てる。DOMや通信には触れない。
export const DAY_MS = 86_400_000;

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const OVERDUE_PREVIEW = 3;

export const SOON_DAYS = 7;

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

export function monthDay(date) {
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

export function scheduleKey(item) {
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

export function scheduleLabel(schedule) {
  if (!schedule?.date) return "日時未設定";
  return schedule.allDay ? shortDate(schedule.date) : `${shortDate(schedule.date)} ${schedule.startTime}–${schedule.endTime}`;
}

export const RESCHEDULE_OFFSETS = { today: 0, tomorrow: 1 };

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

export function isWeekly(habit) {
  return habit.cadence === "weekly";
}

/** 昨日が対象日だった毎日・平日のHabitで、記録がないもの（#155）。Hubから昨日分をワンタップで記録できる。 */
export function missedYesterday(payload) {
  const today = payload?.today;
  if (!today) return [];
  const yesterday = addDays(today, -1);
  return (payload.habits || []).filter((habit) => {
    if (habit.status !== "active" || (habit.cadence !== "daily" && habit.cadence !== "weekdays")) return false;
    const day = (habit.history || []).find((entry) => entry.date === yesterday);
    return Boolean(day?.eligible && !day.completed && !day.skipped);
  });
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
    // 今日休んだHabit・目標に届かず休んだ週のHabitは分母から外す（#164）
    dailyTarget: daily.filter((habit) => !habit.skippedToday).length,
    weeklyDone: weekly.filter((habit) => habit.completedThisWeek).length,
    weeklyTarget: weekly.filter((habit) => habit.completedThisWeek || !habit.skippedThisWeek).length,
  };
}

/** 直近7日の履歴から、今日（未記録なら昨日）までの連続日数を数える。対象外の日は飛ばす。 */
export function habitStreak(habit) {
  const history = [...(habit.history || [])].sort((left, right) => left.date.localeCompare(right.date));
  let index = history.length - 1;
  if (index >= 0 && !history[index].completed && !history[index].skipped) index -= 1;
  let streak = 0;
  for (; index >= 0; index -= 1) {
    const day = history[index];
    // 対象外の日と休んだ日（#164）は飛ばして数える。休んでも連続は切れない
    if (!day.eligible || day.skipped) continue;
    if (!day.completed) break;
    streak += 1;
  }
  return streak;
}

/** どの頻度でも、チップは今日の記録をつける・取り消す。毎週のHabitも1日1回ずつ数える（#163）。 */
export function habitPressed(habit) {
  return Boolean(habit.completedToday);
}

// ---------- Project ----------

/** 期日がこの日数以内のタスクは「着手が必要」に出す（#154）。 */
export const DUE_SOON_DAYS = 3;

/** 「着手が必要」で最初に見せる件数。残りは「あとN件を表示」で開く。 */
export const PROJECT_PREVIEW = 5;

export const NO_DATE = "9999-12-31";

export function openActions(project) {
  // APIはnextを先頭に、あとで行うActionを並べ替えた順で返す。
  return (project.actions || []).filter((action) => action.status === "next" || action.status === "queued");
}

/** タスクを「着手が必要」に出す理由。出さないときはnull。 */
export function taskReason(action, today) {
  if (action.dueOn && action.dueOn < today) return "overdue";
  if (action.dueOn === today) return "due_today";
  if (action.dueOn && daysBetween(today, action.dueOn) <= DUE_SOON_DAYS) return "due_soon";
  if (action.startOn && action.startOn <= today) return "started";
  if (action.status === "next") return "pinned";
  return null;
}

export const kindOrder = { review: 0, missing: 1, task: 2 };

/**
 * Hubの「着手が必要」。Projectをまたいで、期日が近い・着手日が来た・今やるにしたタスクを期日順に集める。
 * あわせて、未完了タスクがないactive Project（missing）と、見直し日が来た待機・保留Project（review）も出す。
 */
export function projectRows(payload, today) {
  const rows = [];
  for (const project of payload?.projects || []) {
    if (project.status === "active") {
      const open = openActions(project);
      if (!open.length) {
        rows.push({ project, kind: "missing", action: null, reason: "missing", key: today, position: 0, queued: [] });
        continue;
      }
      open.forEach((action, position) => {
        const reason = taskReason(action, today);
        if (!reason) return;
        rows.push({
          project,
          kind: "task",
          action,
          reason,
          key: action.dueOn || NO_DATE,
          position,
          queued: open.filter((candidate) => candidate.status === "queued" && candidate.id !== action.id),
        });
      });
    } else if ((project.status === "waiting" || project.status === "on_hold") && project.reviewOn && project.reviewOn <= today) {
      rows.push({ project, kind: "review", action: null, reason: "review", key: project.reviewOn, position: 0, queued: [] });
    }
  }
  return rows.sort((left, right) =>
    left.key.localeCompare(right.key)
    || kindOrder[left.kind] - kindOrder[right.kind]
    || (left.project.targetOn || NO_DATE).localeCompare(right.project.targetOn || NO_DATE)
    || left.project.id - right.project.id
    || left.position - right.position);
}

/** 期限超過・今日が期日のProjectタスクの件数。残っている間は「今日の分はすべて完了」にしない。 */
export function projectTasksDueToday(payload, today) {
  return projectRows(payload, today).filter((row) => row.reason === "overdue" || row.reason === "due_today").length;
}

// ---------- 今日の完了数 ----------

export function completedOn(value, today) {
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
