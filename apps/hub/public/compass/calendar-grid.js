// ToDoのカレンダー表示で使う日付の計算と、ドラッグで日付を移すときの検証。
// DOMに触れない純粋な関数だけを置き、Nodeのテストから直接読み込む。
// 日付は "YYYY-MM-DD" の文字列で、すべてAsia/Tokyoの暦日として扱う。

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

/** 日本時間の今日。 */
export function tokyoToday(now = new Date()) {
  return dateString(new Date(now.getTime() + 9 * 60 * 60 * 1000));
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [year, number] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + delta, 1));
  return dateString(shifted).slice(0, 7);
}

export function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return `${year}年${number}月`;
}

/** 日曜始まりの月カレンダー。月をまたぐ週の前後の日も `inMonth: false` で含める（4〜6週）。 */
export function monthGrid(month) {
  const first = utcDate(`${month}-01`);
  const start = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
  const nextMonth = utcDate(`${shiftMonth(month, 1)}-01`);
  const weeks = [];
  for (let cursor = start; cursor < nextMonth; cursor = new Date(cursor.getTime() + 7 * DAY_MS)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => {
      const date = dateString(new Date(cursor.getTime() + index * DAY_MS));
      return { date, inMonth: monthOf(date) === month };
    }));
  }
  return weeks;
}

/** 予定のある日付ごとにまとめる。終日が先、次に開始時刻の順。 */
export function groupByDate(items) {
  const groups = new Map();
  for (const item of items) {
    const date = item.schedule?.date;
    if (typeof date !== "string") continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => {
      if (left.schedule.allDay !== right.schedule.allDay) return left.schedule.allDay ? -1 : 1;
      return (left.schedule.startTime || "").localeCompare(right.schedule.startTime || "") || left.id - right.id;
    });
  }
  return groups;
}

/** Google Calendarの予定と紐づいていて、日時を変えられるToDoだけをドラッグできる。 */
export function isDraggableTodo(item) {
  return item.status === "pending" && item.calendarState === "confirmed" && Boolean(item.calendarEtag) && Boolean(item.schedule?.date);
}

function endsInFuture(schedule, now) {
  const end = schedule.allDay
    ? new Date(`${schedule.date}T23:59:59+09:00`)
    : new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() > now.getTime();
}

/**
 * ToDoを別の日へ移す計画。日付だけを変え、終日・開始・終了の時刻は保つ。
 * サーバーも「終了が現在より後」を検証するので、同じ条件を先に確かめて無駄な通信を避ける。
 */
export function planMove(item, date, now = new Date()) {
  if (!isDraggableTodo(item)) return { ok: false, reason: "not-movable" };
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "invalid" };
  if (date === item.schedule.date) return { ok: false, reason: "same-date" };
  const schedule = {
    allDay: Boolean(item.schedule.allDay),
    date,
    startTime: item.schedule.allDay ? null : item.schedule.startTime,
    endTime: item.schedule.allDay ? null : item.schedule.endTime,
    timeZone: "Asia/Tokyo",
  };
  if (!endsInFuture(schedule, now)) return { ok: false, reason: "past" };
  return { ok: true, schedule };
}

/** "2026-10-12" → "10月12日（月）" */
export function formatMonthDay(date) {
  const value = utcDate(date);
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日（${WEEKDAYS[value.getUTCDay()]}）`;
}
