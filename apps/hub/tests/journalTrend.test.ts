import assert from "node:assert/strict";
import test from "node:test";
import { renderJournalTrendHtml, weeklyMoodAverages, yesterdayMissing } from "../public/journal-trend.js";

test("mood graph draws weekly averages that fit the screen and still lists exact recorded dates", () => {
  const days = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
    mood: index === 87 ? -1 : index === 89 ? 0 : null,
  }));
  const html = renderJournalTrendHtml({ startDate: days[0].date, endDate: days[89].date, days });
  assert.match(html, /記録 2日/);
  assert.match(html, /最新 <time datetime="2026-09-14">2026年9月14日<\/time> <b>普通<\/b>/);
  assert.match(html, /日付ごとの記録を見る/);
  assert.match(html, /<time datetime="2026-09-12">/);
  // 横スクロールの固定幅をやめ、画面幅に合わせて伸縮する
  assert.doesNotMatch(html, /journal-trend-viewport|976/);
  assert.match(html, /preserveAspectRatio="none"/);
  // 記録のある週（最後の週）だけ棒を出す。9/12(-1)と9/14(0)の平均は-0.5
  assert.equal((html.match(/class="journal-week-bar"/g) || []).length, 1);
  assert.match(html, /9\/8〜9\/14 · 平均 普通（-0.5） · 記録2日/);
});

test("weekly averages split 90 days into 13 weeks ending today and ignore days without a mood", () => {
  const days = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
    mood: index >= 83 ? (index % 2 ? 2 : 1) : null,
  }));
  const weeks = weeklyMoodAverages(days);
  assert.equal(weeks.length, 13);
  assert.deepEqual(weeks[0], { startDate: "2026-06-17", endDate: "2026-06-22", recorded: 0, average: null });
  assert.equal(weeks[12].startDate, "2026-09-08");
  assert.equal(weeks[12].endDate, "2026-09-14");
  assert.equal(weeks[12].recorded, 7);
  assert.equal(weeks[12].average, 1.6);
});

test("yesterday's missing journal is reported only when the day has no row at all", () => {
  const days = (yesterday: { mood: number | null; recorded?: boolean }) => Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
    ...(index === 88 ? yesterday : { mood: null, recorded: false }),
  }));
  const trend = (yesterday: { mood: number | null; recorded?: boolean }) => ({ startDate: "2026-06-17", endDate: "2026-09-14", days: days(yesterday) });
  assert.equal(yesterdayMissing(trend({ mood: null, recorded: false })), true);
  // 気分が空でも行があれば記録済み
  assert.equal(yesterdayMissing(trend({ mood: null, recorded: true })), false);
  assert.equal(yesterdayMissing(trend({ mood: 1, recorded: true })), false);
  // 古い応答（recordedが無い）・取得不可では知らせない
  assert.equal(yesterdayMissing(trend({ mood: null })), false);
  assert.equal(yesterdayMissing(null), false);
});

test("mood graph distinguishes empty data from an unavailable source", () => {
  const days = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
    mood: null,
  }));
  assert.match(renderJournalTrendHtml({ startDate: days[0].date, endDate: days[89].date, days }), /記録はありません/);
  assert.match(renderJournalTrendHtml(null, false), /取得できませんでした/);
  assert.match(renderJournalTrendHtml({ startDate: '2026-06-17"', endDate: days[89].date, days }), /表示できませんでした/);
});
