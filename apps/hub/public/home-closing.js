// ホームの「今日の締め」（#337）のうち、DOMに触れない部分。夜に、今日やり残した記録を1か所で確かめる。
// 罰則や連続日数の途切れとしては扱わず、残っているものへの導線だけを出す。値が分からない行は出さない。

/** 締めの欄を出し始める時刻（日本時間）。 */
export const CLOSING_HOUR = 18;

/** @type {typeof import("./home-closing.d.ts").jstHour} */
export function jstHour(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

/** 次に締めの欄を出す時刻までのミリ秒。もう出す時間なら0。 */
/** @type {typeof import("./home-closing.d.ts").msUntilClosing} */
export function msUntilClosing(now = new Date()) {
  if (jstHour(now) >= CLOSING_HOUR) return 0;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), CLOSING_HOUR) - 9 * 60 * 60 * 1000;
  return Math.max(0, target - now.getTime());
}

/** @param {unknown} value */
const count = (value) => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null);

/** @param {unknown} trend @param {number} index */
function journalRecorded(trend, index) {
  const days = /** @type {{ days?: Array<{ recorded?: unknown }> } | null} */ (trend)?.days;
  if (!Array.isArray(days) || days.length !== 90) return null;
  const recorded = days[index]?.recorded;
  return typeof recorded === "boolean" ? recorded : null;
}

/** @type {typeof import("./home-closing.d.ts").closingView} */
export function closingView({ summary, journalTrend, today, navigation }, now = new Date()) {
  if (jstHour(now) < CLOSING_HOUR) return { show: false, completed: null, rows: [], done: false };
  // Habitは今日の欄の値（その場で記録すると変わる）を優先し、まだ読めていなければHub本体の件数を使う。
  const habitsLeft = count(today?.habitsLeft) ?? count(summary?.remainingHabitsToday);
  const unclassified = count(summary?.unclassifiedExpenses);
  const inbox = count(summary?.pendingInbox);
  const todayJournal = journalRecorded(journalTrend, 89);
  const yesterdayJournal = journalRecorded(journalTrend, 88);
  const known = [habitsLeft, unclassified, inbox, todayJournal, yesterdayJournal].filter((value) => value !== null);
  const rows = [
    habitsLeft ? { key: "habits", label: `未記録のHabit ${habitsLeft}件`, href: "#todayPanel" } : null,
    todayJournal === false ? { key: "journal-today", label: "今日の日記がまだありません", href: null } : null,
    yesterdayJournal === false ? { key: "journal-yesterday", label: "昨日の日記がまだありません", href: null } : null,
    unclassified ? { key: "unclassified", label: `未分類の支出 ${unclassified}件`, href: navigation?.financial || "/finance/" } : null,
    inbox ? { key: "inbox", label: `未整理のInbox ${inbox}件`, href: navigation?.compass || "/compass/" } : null,
  ].filter((row) => row !== null);
  return { show: known.length > 0, completed: count(today?.completed), rows, done: rows.length === 0 };
}
