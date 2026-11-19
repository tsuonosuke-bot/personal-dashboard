const MOOD_LABELS = ["かなり低い", "低い", "普通", "良い", "とても良い"];

/** @param {number} value */
function moodLabel(value) {
  return MOOD_LABELS[value + 2] || "記録なし";
}

/** @param {string} value */
function displayDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

/** @param {string} value */
function shortDate(value) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
}

/** @param {unknown} value */
function isPlainDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** @param {number | null} value @returns {value is number} */
function isMood(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= -2 && value <= 2;
}

/** @param {import("./journal-trend.d.ts").JournalTrendDay} day @returns {day is {date: string, mood: number}} */
function isRecordedDay(day) {
  return isMood(day.mood);
}

/**
 * 直近90日を、今日で終わる7日ずつの週に分ける（90日 = 6日 + 7日×12）。記録のない日は平均に入れず、0としても扱わない。
 * @type {typeof import("./journal-trend.d.ts").weeklyMoodAverages}
 */
export function weeklyMoodAverages(days) {
  const weeks = [];
  for (let end = days.length; end > 0; end -= 7) {
    const slice = days.slice(Math.max(0, end - 7), end);
    const moods = slice.map((day) => day.mood).filter(isMood);
    weeks.unshift({
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      recorded: moods.length,
      average: moods.length ? Math.round(moods.reduce((sum, mood) => sum + mood, 0) / moods.length * 10) / 10 : null,
    });
  }
  return weeks;
}

/** @param {number} value */
function averageLabel(value) {
  const nearest = Math.max(-2, Math.min(2, Math.round(value)));
  return `${moodLabel(nearest)}（${value > 0 ? "+" : ""}${value.toFixed(1)}）`;
}

/**
 * 昨日のJournalが無いかどうか。今日の分はまだ書いていなくて当然なので見ない。気分が空でも行があれば記録済み。
 * 判定できないとき（古い応答・取得不可）はfalse（知らせない）。
 * @type {typeof import("./journal-trend.d.ts").yesterdayMissing}
 */
export function yesterdayMissing(trend) {
  const days = trend?.days;
  if (!Array.isArray(days) || days.length !== 90) return false;
  const yesterday = days[88];
  return typeof yesterday?.recorded === "boolean" ? !yesterday.recorded : false;
}

/** @type {typeof import("./journal-trend.d.ts").renderJournalTrendHtml} */
export function renderJournalTrendHtml(trend, available = true) {
  if (!available) return '<p class="journal-trend-state">気分の推移を取得できませんでした</p>';
  const days = trend?.days;
  if (!trend || !Array.isArray(days) || days.length !== 90 || !isPlainDate(trend.startDate) || !isPlainDate(trend.endDate) || days.some((day) => !isPlainDate(day.date))) {
    return '<p class="journal-trend-state">気分の推移を表示できませんでした</p>';
  }
  const recorded = days.filter(isRecordedDay);
  if (!recorded.length) return '<p class="journal-trend-state">直近90日に気分の記録はありません</p>';

  const latest = recorded[recorded.length - 1];
  const weeks = weeklyMoodAverages(days);
  // 週の平均を「普通」から上下に伸びる棒で描く。棒の長さだけを伸縮させるので、画面幅に合わせて横に引き伸ばしてよい（文字はSVGの外に置く）。
  const slot = 10;
  const width = weeks.length * slot;
  /** @param {number} mood */
  const y = (mood) => 60 - mood * 27;
  const grid = [2, 1, 0, -1, -2].map((mood) => `<line class="journal-week-grid${mood === 0 ? " is-zero" : ""}" x1="0" x2="${width}" y1="${y(mood)}" y2="${y(mood)}" vector-effect="non-scaling-stroke"/>`).join("");
  const bars = weeks.map((week, index) => {
    if (week.average === null) return "";
    const top = Math.min(y(week.average), y(0));
    const height = Math.max(1.5, Math.abs(y(week.average) - y(0)));
    const tone = week.average > 0 ? "up" : week.average < 0 ? "down" : "flat";
    return `<rect class="journal-week-bar" data-tone="${tone}" x="${index * slot + 2}" y="${top}" width="${slot - 4}" height="${height}"><title>${shortDate(week.startDate)}〜${shortDate(week.endDate)} · 平均 ${averageLabel(week.average)} · 記録${week.recorded}日</title></rect>`;
  }).join("");
  // 4週ごとに週の初日を出す（最新の週を含める）。
  const labels = weeks.map((week, index) => `<span>${(weeks.length - 1 - index) % 4 === 0 ? shortDate(week.startDate) : ""}</span>`).join("");
  const summary = weeks.flatMap((week) => week.average === null ? [] : [`${shortDate(week.startDate)}〜${shortDate(week.endDate)} ${averageLabel(week.average)}`]).join("、");
  const records = [...recorded].reverse().map((day) => `<li><time datetime="${day.date}">${displayDate(day.date)}</time><strong>${moodLabel(day.mood)}</strong></li>`).join("");

  return `<div class="journal-trend">
    <div class="journal-trend-heading"><div><strong>気分のバロメーター</strong><small>直近90日の週平均 · 記録 ${recorded.length}日</small></div><p>最新 <time datetime="${latest.date}">${displayDate(latest.date)}</time> <b>${moodLabel(latest.mood)}</b></p></div>
    <div class="journal-week-chart">
      <div class="journal-week-scale" aria-hidden="true"><span>とても良い</span><span>普通</span><span>かなり低い</span></div>
      <svg viewBox="0 0 ${width} 120" preserveAspectRatio="none" role="img" aria-label="直近90日の気分の週平均。記録のない週は棒を出していません。${summary}" xmlns="http://www.w3.org/2000/svg">${grid}${bars}</svg>
      <div class="journal-week-dates" aria-hidden="true">${labels}</div>
    </div>
    <details class="journal-trend-records"><summary>日付ごとの記録を見る</summary><ol>${records}</ol></details>
  </div>`;
}
