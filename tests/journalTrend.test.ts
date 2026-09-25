import assert from "node:assert/strict";
import test from "node:test";
import { renderJournalTrendHtml } from "../public/journal-trend.js";

test("mood graph leaves missing dates disconnected and lists exact recorded dates", () => {
  const days = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
    mood: index === 87 ? -1 : index === 89 ? 0 : null,
  }));
  const html = renderJournalTrendHtml({ startDate: days[0].date, endDate: days[89].date, days });
  assert.match(html, /記録 2日/);
  assert.match(html, /最新 <time datetime="2026-09-14">2026年9月14日<\/time> <b>普通<\/b>/);
  assert.match(html, /2026年9月12日 · 低い/);
  assert.doesNotMatch(html, /class="journal-trend-line"/);
  assert.match(html, /日付ごとの記録を見る/);
  assert.match(html, /<time datetime="2026-09-12">/);
  assert.match(html, /<time datetime="2026-09-14">/);
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
