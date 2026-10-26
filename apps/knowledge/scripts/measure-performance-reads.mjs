// Reproducible synthetic comparison. No credentials, network or production data.
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { filterKnowledge } from "../src/lib/knowledge.ts";
import { weeklyReviewAccuracy } from "../src/lib/learningSummary.ts";
import { getKnowledge, getQuizLog, getAutoTags } from "../src/lib/api.ts";
import { getLearningSummary } from "../src/lib/learningReadApi.ts";

const today = "2026-10-26", now = new Date("2026-10-26T03:00:00Z");
const filters = { search: "", category: "すべて", mastery: "すべて", priority: "すべて", knowledge_kind: "すべて", review: "today" };
const card = (i, archived = false) => ({ id: `card-${i}`, title: `Card ${i}`, explanation: "source".repeat(30), source_note: null,
  claim_evidence: null, category: "技術", knowledge_kind: "事実", mastery: "学習中", priority: "中", tags: [],
  ef: 2.5, reps: 1, interval_days: 1, times_asked: 3, times_correct: 2, learned_on: today, last_asked_on: today,
  next_review_on: today, next_review_at: i % 2 ? "2026-10-26T23:59:59+09:00" : "2026-10-25T23:59:59+09:00",
  stability_hours: 48, relearning_stage: null, last_reviewed_at: now.toISOString(), mastery_streak: 0,
  archived, created_at: now.toISOString(), content_version: 1, accuracy: 66.67, auto_tags: [] });
const row = (i) => ({ id: i + 1, knowledge_id: `card-${i % 1000}`, asked_on: `2026-10-${String(i % 26 + 1).padStart(2, "0")}`,
  quality: 3, verdict: i % 3 ? "正解" : "不正解", format: "記述説明", note: "note", created_at: now.toISOString(),
  answered_at: now.toISOString(), confirmed_at: now.toISOString(), review_queue_id: i + 1,
  question: "Question ".repeat(25), user_answer: "User answer ".repeat(25), correct_answer: "Model answer ".repeat(25), explanation: "Feedback ".repeat(40) });
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function time(fn) { fn(); return median(Array.from({ length: 5 }, () => { const start = performance.now(); fn(); return performance.now() - start; })); }
function legacyToday(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function oldFilter(cards) { return cards.filter((card) => legacyToday(new Date(Date.parse(card.next_review_at))) === today); }
const allCards = Array.from({ length: 1500 }, (_, i) => card(i, i >= 1000));
const active = allCards.filter((card) => !card.archived);
const results = { environment: { node: process.version, platform: process.platform, architecture: process.arch, measuredAt: new Date().toISOString(),
  repetitions: 5, statistic: "median after one warm-up", scope: "synthetic local; no real network latency, browser long tasks, production data or production rates" }, todayFilter: [], initialRead: [], chartHover: [], cardMasteryPayload: [] };
for (const size of [1000, 5000]) {
  const cards = Array.from({ length: size }, (_, i) => card(i));
  const actualFilters = { ...filters, category: "all", mastery: "all", priority: "all", knowledge_kind: "all" };
  // ALL is imported through the actual constants below (Japanese labels are not filter values).
  const { ALL } = await import("../src/constants.ts");
  actualFilters.category = actualFilters.mastery = actualFilters.priority = actualFilters.knowledge_kind = ALL;
  const expected = oldFilter(cards).map((card) => card.id);
  const actual = filterKnowledge(cards, actualFilters, today, now).map((card) => card.id);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("today result differs");
  results.todayFilter.push({ cards: size, matched: expected.length, beforeMs: time(() => oldFilter(cards)), afterMs: time(() => filterKnowledge(cards, actualFilters, today, now)),
    beforeFormatterConstructionsPerCall: size, afterFormatterConstructionsPerCall: 0 });
}

for (const size of [1000, 5000, 10000]) {
  const logs = Array.from({ length: size }, (_, i) => row(i));
  const byDay = new Map();
  for (const log of logs) {
    const day = byDay.get(log.asked_on) ?? { date: log.asked_on, total: 0, correct: 0 }; day.total++; if (log.verdict === "正解") day.correct++;
    byDay.set(log.asked_on, day);
  }
  const summary = { date: today, today: { answered: 0, correct: 0, cards: 0, accuracy: null }, misses: { total: 0, wrong: 0, partial: 0 },
    weekly: weeklyReviewAccuracy(logs, now), history: [...byDay.values()].map((day) => ({ ...day, accuracy: Math.round(day.correct / day.total * 100) })),
    registrationDays: [{ date: today, count: 1500 }], memory: { "1d": 1000 }, archivedCount: 500, categories: ["技術"], tags: [] };
  const original = globalThis.fetch;
  try {
    async function measure(mode) {
      const metrics = { requests: 0, bytes: 0, readyMs: 0, quizBodyRows: 0, archivedBodyRows: 0 };
      globalThis.fetch = async (input) => {
        const url = new URL(String(input), "https://knowledge.example");
        const limit = Number(url.searchParams.get("limit") ?? 1000), offset = Number(url.searchParams.get("offset") ?? 0);
        let value;
        if (url.pathname === "/api/learning-summary") value = summary;
        else {
          const rows = url.pathname === "/api/knowledge" ? (url.searchParams.get("status") === "all" ? allCards : active)
            : url.pathname === "/api/quiz-log" ? logs : [];
          const items = rows.slice(offset, offset + limit);
          metrics.quizBodyRows += url.pathname === "/api/quiz-log" ? items.length : 0;
          metrics.archivedBodyRows += url.pathname === "/api/knowledge" ? items.filter((card) => card.archived).length : 0;
          value = { items, total: rows.length, limit, offset };
        }
        const text = JSON.stringify(value); metrics.requests++; metrics.bytes += Buffer.byteLength(text);
        return new Response(text, { headers: { "Content-Type": "application/json" } });
      };
      const start = performance.now();
      if (mode === "before") await Promise.all([getKnowledge(), getQuizLog(), getAutoTags()]);
      else { const aggregate = getLearningSummary(today); await Promise.all([getKnowledge("active"), getAutoTags()]); metrics.readyMs = performance.now() - start; await aggregate; }
      metrics.readyMs ||= performance.now() - start;
      return metrics;
    }
    await measure("before"); await measure("after");
    const before = [], after = [];
    for (let i = 0; i < 5; i++) { before.push(await measure("before")); after.push(await measure("after")); }
    results.initialRead.push({ logRows: size, activeCards: 1000, archivedCards: 500,
      before: { ...before[0], readyMs: median(before.map((result) => result.readyMs)) }, after: { ...after[0], readyMs: median(after.map((result) => result.readyMs)) } });
  } finally { globalThis.fetch = original; }
}
for (const size of [10000, 100000]) {
  const logs = Array.from({ length: size }, (_, i) => row(i));
  const aggregated = weeklyReviewAccuracy(logs, now);
  results.chartHover.push({ logRows: size, mouseMoves: 10, beforeAggregationCalls: 10, afterAggregationCalls: 0,
    beforeMs: time(() => { for (let i = 0; i < 10; i++) weeklyReviewAccuracy(logs, now); }),
    afterDataAccessMs: time(() => { for (let i = 0; i < 10; i++) aggregated.map((row) => row.answered); }),
    note: "Current charts receive this aggregate as props; aggregate access is a local comparison, not a browser event/long-task measurement." });
}
for (const otherCards of [100, 1000]) {
  const event = (card, i) => ({ id: card * 31 + i, knowledge_id: `card-${card}`, to_mastery: "学習中", is_baseline: i === 0, changed_at: now.toISOString() });
  const all = Array.from({ length: otherCards + 1 }, (_, card) => Array.from({ length: 31 }, (_, i) => event(card, i))).flat();
  const selected = { items: all.slice(0, 10), previous: all[10], total: 31, limit: 10, offset: 0 };
  results.cardMasteryPayload.push({ otherCards, beforeRows: all.length, afterRowsIncludingPredecessor: 11,
    beforeBytes: Buffer.byteLength(JSON.stringify(all)), afterBytes: Buffer.byteLength(JSON.stringify(selected)) });
}
await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
await writeFile(new URL("../docs/performance-measurements-20261026.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
