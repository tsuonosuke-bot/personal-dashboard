const MOOD_LABELS = ["かなり低い", "低い", "普通", "良い", "とても良い"];

function moodLabel(value) {
  return MOOD_LABELS[value + 2] || "記録なし";
}

function displayDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function shortDate(value) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
}

function isPlainDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function renderJournalTrendHtml(trend, available = true) {
  if (!available) return '<p class="journal-trend-state">気分の推移を取得できませんでした</p>';
  const days = trend?.days;
  if (!Array.isArray(days) || days.length !== 90 || !isPlainDate(trend.startDate) || !isPlainDate(trend.endDate) || days.some((day) => !isPlainDate(day.date))) {
    return '<p class="journal-trend-state">気分の推移を表示できませんでした</p>';
  }
  const recorded = days.filter((day) => Number.isInteger(day.mood) && day.mood >= -2 && day.mood <= 2);
  if (!recorded.length) return '<p class="journal-trend-state">直近90日に気分の記録はありません</p>';

  const latest = recorded.at(-1);
  const width = 976;
  const x = (index) => 62 + index * 10;
  const y = (mood) => 18 + (2 - mood) * 30;
  const grid = [2, 1, 0, -1, -2].map((mood) => `<g class="journal-trend-grid"><line x1="62" x2="952" y1="${y(mood)}" y2="${y(mood)}"/><text x="3" y="${y(mood) + 3}">${moodLabel(mood)}</text></g>`).join("");
  const marks = days.map((day, index) => {
    if (!Number.isInteger(day.mood) || day.mood < -2 || day.mood > 2) return "";
    return `<circle class="journal-trend-point" cx="${x(index)}" cy="${y(day.mood)}" r="3.5"><title>${displayDate(day.date)} · ${moodLabel(day.mood)}</title></circle>`;
  }).join("");
  const lines = days.slice(1).map((day, index) => {
    const previous = days[index];
    if (!Number.isInteger(day.mood) || day.mood < -2 || day.mood > 2 || !Number.isInteger(previous.mood) || previous.mood < -2 || previous.mood > 2) return "";
    return `<line class="journal-trend-line" x1="${x(index)}" y1="${y(previous.mood)}" x2="${x(index + 1)}" y2="${y(day.mood)}"/>`;
  }).join("");
  const axisDates = Array.from({ length: 13 }, (_, week) => week * 7).concat(89);
  const axis = axisDates.map((index) => {
    const position = x(index);
    const anchor = index === 0 ? "start" : index === 89 ? "end" : "middle";
    return `<g class="journal-trend-tick"><line x1="${position}" x2="${position}" y1="143" y2="149"/><text x="${position}" y="164" text-anchor="${anchor}">${shortDate(days[index].date)}</text></g>`;
  }).join("");
  const records = [...recorded].reverse().map((day) => `<li><time datetime="${day.date}">${displayDate(day.date)}</time><strong>${moodLabel(day.mood)}</strong></li>`).join("");

  return `<div class="journal-trend">
    <div class="journal-trend-heading"><div><strong>気分のバロメーター</strong><small>直近90日 · 記録 ${recorded.length}日</small></div><p>最新 <time datetime="${latest.date}">${displayDate(latest.date)}</time> <b>${moodLabel(latest.mood)}</b></p></div>
    <p class="journal-trend-scale">上：とても良い ／ 中央：普通 ／ 下：かなり低い。横にスクロールして過去へ。</p>
    <div class="journal-trend-viewport" tabindex="0" aria-label="気分のグラフ。横にスクロールして過去の記録を表示">
      <svg viewBox="0 0 ${width} 176" role="img" aria-label="直近90日の気分。記録のない日は線をつないでいません。最新は${displayDate(latest.date)}、${moodLabel(latest.mood)}。" xmlns="http://www.w3.org/2000/svg">${grid}${lines}${marks}${axis}</svg>
    </div>
    <details class="journal-trend-records"><summary>日付ごとの記録を見る</summary><ol>${records}</ol></details>
  </div>`;
}
