// DOMに依存しない日付の短い表示（テストから直接読み込む）。
// 一覧の日付は「11/17」と短く出す。今年でなければ年も付ける。
export function formatShortDate(value, now = new Date()) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  const thisYear = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric" }).formatToParts(now).find((part) => part.type === "year")?.value;
  return parts.year === thisYear ? `${parts.month}/${parts.day}` : `${parts.year}/${parts.month}/${parts.day}`;
}
