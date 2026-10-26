import { requestJson } from "./api.ts";
import { parseKnowledge, parsePageEnvelope, parseQuizLog } from "./apiValidation.ts";
import type { LearningLogEntry, LearningLogFilters } from "./learningLog";
import type { MemoryHoldBucket, TodayAnswers, WeeklyAccuracy } from "./learningSummary";
import type { QuizLog } from "../types";

export interface LearningSummary {
  date: string;
  today: TodayAnswers;
  misses: { total: number; wrong: number; partial: number };
  weekly: WeeklyAccuracy[];
  history: { date: string; total: number; correct: number; accuracy: number }[];
  registrationDays: { date: string; count: number }[];
  memory: Record<string, number>;
  archivedCount: number;
  categories: string[];
  tags: string[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("学習データの応答形式が正しくありません。");
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("学習データの件数が正しくありません。");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("学習データの日付が正しくありません。");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("学習データの一覧が正しくありません。");
  return value;
}
function rate(value: unknown, max = 1): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new Error("学習データの割合が正しくありません。");
  return value;
}
export function parseLearningSummary(raw: unknown): LearningSummary {
  const value = record(raw), today = record(value.today), misses = record(value.misses);
  const memory = Object.fromEntries(Object.entries(record(value.memory)).map(([key, value]) => [key, count(value)]));
  const names = (raw: unknown) => array(raw).map((item) => { if (typeof item !== "string") throw new Error("学習データの分類が正しくありません。"); return item; });
  return { date: date(value.date), archivedCount: count(value.archivedCount), memory,
    categories: names(value.categories), tags: names(value.tags),
    today: { answered: count(today.answered), correct: count(today.correct), cards: count(today.cards), accuracy: rate(today.accuracy) },
    misses: { total: count(misses.total), wrong: count(misses.wrong), partial: count(misses.partial) },
    weekly: array(value.weekly).map((raw) => {
      const row = record(raw);
      if (typeof row.partial !== "boolean") throw new Error("学習データの週情報が正しくありません。");
      return { weekStart: date(row.weekStart), answered: count(row.answered), correct: count(row.correct), accuracy: rate(row.accuracy), partial: row.partial };
    }),
    history: array(value.history).map((raw) => { const row = record(raw); const accuracy = rate(row.accuracy, 100);
      if (accuracy === null) throw new Error("学習データの割合が正しくありません。");
      return { date: date(row.date), total: count(row.total), correct: count(row.correct), accuracy }; }),
    registrationDays: array(value.registrationDays).map((raw) => { const row = record(raw); return { date: date(row.date), count: count(row.count) }; }),
  };
}
export async function getLearningSummary(today: string) {
  return parseLearningSummary(await requestJson(`/api/learning-summary?${new URLSearchParams({ today })}`, { method: "GET" }));
}
export function learningQuery(filters: LearningLogFilters, today: string) {
  const query = new URLSearchParams();
  if (filters.period !== "all") query.set("from", new Date(Date.parse(`${today}T00:00:00Z`) - (Number(filters.period) - 1) * 86_400_000).toISOString().slice(0, 10));
  if (filters.category !== "all") query.set("category", filters.category);
  if (filters.verdict !== "all") query.set("verdict", filters.verdict);
  return query;
}
export async function getLearningLogPage(query: URLSearchParams, limit: number, offset: number) {
  const params = new URLSearchParams(query);
  params.set("limit", String(limit)); params.set("offset", String(offset));
  const raw = await requestJson(`/api/learning-log?${params}`, { method: "GET" });
  const envelope = parsePageEnvelope(raw), value = record(raw);
  if (envelope.total === null || envelope.limit !== limit || envelope.offset !== offset || envelope.items.length > limit) throw new Error("学習ログのページ情報が正しくありません。");
  const items: LearningLogEntry[] = envelope.items.map((raw) => {
    const row = record(raw);
    if (typeof row.title !== "string" || typeof row.category !== "string") throw new Error("学習ログの応答が正しくありません。");
    return { ...parseQuizLog(row), title: row.title, category: row.category };
  });
  return { ...envelope, total: envelope.total, items, correct: count(value.correct), unconfirmed: count(value.unconfirmed) };
}
export async function snapshotReviewResultIds(query: URLSearchParams) {
  const params = new URLSearchParams(query); params.set("ids", "true");
  const raw = await requestJson(`/api/learning-log?${params}`, { method: "GET" });
  return [...new Set(array(raw).map((id) => { if (count(id) === 0) throw new Error("履歴IDが正しくありません。"); return id as number; }))];
}
export type ReviewConfirmationState = Pick<QuizLog, "id" | "review_queue_id" | "confirmed_at">;
export async function getReviewConfirmationState(ids: readonly number[]): Promise<ReviewConfirmationState[]> {
  const chunks: number[][] = [];
  for (let start = 0; start < ids.length; start += 200) chunks.push(ids.slice(start, start + 200));
  const pages = await Promise.all(chunks.map(async (chunk) => {
    const raw = await requestJson(`/api/learning-log/confirmation-state?${new URLSearchParams({ ids: chunk.join(",") })}`, { method: "GET" });
    return array(raw).map((raw) => {
      const row = record(raw), id = count(row.id);
      if (!chunk.includes(id) || row.confirmed_at !== null && typeof row.confirmed_at !== "string"
        || row.review_queue_id !== null && (typeof row.review_queue_id !== "number" || !Number.isSafeInteger(row.review_queue_id))) throw new Error("確認状態の応答が正しくありません。");
      return { id, confirmed_at: row.confirmed_at as string | null, review_queue_id: row.review_queue_id as number | null };
    });
  }));
  return pages.flat();
}
export async function getArchivePage(search: string, offset: number, limit = 30) {
  const raw = await requestJson(`/api/knowledge?${new URLSearchParams({ status: "archived", search, limit: String(limit), offset: String(offset) })}`, { method: "GET" });
  const page = parsePageEnvelope(raw);
  if (page.total === null || page.limit !== limit || page.offset !== offset) throw new Error("アーカイブのページ情報が正しくありません。");
  return { items: page.items.map(parseKnowledge), total: page.total };
}
export function summaryMemory(summary: LearningSummary) {
  const labels = [["30d", "30日以上"], ["7d", "7〜30日"], ["3d", "3〜7日"], ["1d", "1〜3日"], ["0d", "1日未満"]];
  const buckets: MemoryHoldBucket[] = labels.map(([key, label]) => ({ key, label, count: summary.memory[key] ?? 0 }));
  const unasked = summary.memory.unasked ?? 0;
  return { buckets, unasked, total: unasked + buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    atLeastWeek: (summary.memory["30d"] ?? 0) + (summary.memory["7d"] ?? 0) };
}
