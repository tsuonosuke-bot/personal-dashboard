// 共通部品: 日付・HTMLエスケープ・ToDoの期限表示・トースト・接続状態の表示。
import { els } from "./state.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value, includeTime = false) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", includeTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }
  ).format(date);
}

export function calendarSchedule(value) {
  const schedule = value?.calendar;
  if (!schedule || schedule.timeZone !== "Asia/Tokyo" || typeof schedule.date !== "string") return null;
  return schedule;
}

export function formatCalendarSchedule(schedule) {
  if (!schedule) return "日時未設定";
  const date = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" })
    .format(new Date(`${schedule.date}T00:00:00+09:00`));
  return schedule.allDay ? `${date}（終日）` : `${date} ${schedule.startTime}–${schedule.endTime}`;
}

export function todoTiming(item, now = new Date()) {
  if (item.calendarState === "missing" || item.calendarState === "cancelled") return "overdue";
  const schedule = item.schedule;
  if (!schedule?.date) return "overdue";
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (schedule.date < today) return "overdue";
  if (schedule.date > today) return "upcoming";
  if (schedule.allDay) return "today";
  const end = new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime() ? "overdue" : "today";
}

export function sortTodos(items) {
  const rank = { overdue: 0, today: 1, upcoming: 2 };
  return [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === "pending" ? -1 : right.status === "pending" ? 1 : 0;
    const timingDifference = (rank[todoTiming(left)] ?? 3) - (rank[todoTiming(right)] ?? 3);
    if (timingDifference) return timingDifference;
    const leftSchedule = `${left.schedule?.date || "9999-12-31"}T${left.schedule?.startTime || "00:00"}`;
    const rightSchedule = `${right.schedule?.date || "9999-12-31"}T${right.schedule?.startTime || "00:00"}`;
    return leftSchedule.localeCompare(rightSchedule) || right.id - left.id;
  });
}

export function todoTimingLabel(item) {
  if (item.calendarState === "missing") return "Calendar予定なし";
  if (item.calendarState === "cancelled") return "Calendarで取消済み";
  return ({ overdue: "実施確認待ち", today: "今日", upcoming: "今後" })[todoTiming(item)];
}

export function setSource(source, error = false) {
  els.sourceBadge.className = "source-badge";
  if (error) {
    els.sourceBadge.classList.add("error");
    els.sourceBadge.lastChild.textContent = "接続エラー";
    return;
  }
  const demo = source.state === "demo";
  els.sourceBadge.classList.add(demo ? "demo" : "live");
  els.sourceBadge.lastChild.textContent = demo ? "DEMO DATA" : "SUPABASE LIVE";
}

export function defaultRevisitDate() {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = today.getUTCDate();
  const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day));
  if (target.getUTCDate() !== day) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

export function todayInTokyo() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dateOffset(days) {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextWeekendDate() {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 6 ? 7 : (6 - day + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

export function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 3500);
}
