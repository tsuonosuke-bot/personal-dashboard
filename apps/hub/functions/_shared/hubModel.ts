/** Pure Hub summary and journal mapping; upstream access lives in hubSources. */
import { type DashboardEnv } from "./dashboard.ts";
import { type FocusRow, normalizeFocusRows, FOCUS_LIMIT } from "./focus.ts";
import { type ReviewBatchesStatus } from "./reviewBatches.ts";
import { type DatabaseUsage } from "./databaseUsage.ts";

export interface HubEnv extends DashboardEnv {
  HUB_SERVICE_TOKEN?: string;
}

export interface HubAvailability {
  inbox: boolean;
  wants: boolean;
  focus: boolean;
  projects: boolean;
  writing: boolean;
  expenses: boolean;
  knowledge: boolean;
  journal: boolean;
  journalTrend?: boolean;
  habits?: boolean;
}

type TableName = "idea_inbox" | "wants" | "focus_items" | "projects" | "writing_topics" | "expenses" | "knowledge" | "daily_journal";

export interface InboxRow {
  id?: unknown;
  content?: unknown;
  status?: unknown;
  created_at?: unknown;
}

export interface WantRow {
  id?: unknown;
  content?: unknown;
  status?: unknown;
  type?: unknown;
  revisit_on?: unknown;
  created_at?: unknown;
}

export interface ProjectRow {
  status?: unknown;
}

export interface WritingRow {
  status?: unknown;
}

export interface ExpenseRow {
  id?: unknown;
  transaction_date?: unknown;
  amount?: unknown;
  title?: unknown;
  category?: unknown;
  payer?: unknown;
  created_at?: unknown;
}

export interface KnowledgeRow {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  mastery?: unknown;
  times_asked?: unknown;
  times_correct?: unknown;
  accuracy?: unknown;
  next_review_on?: unknown;
  created_at?: unknown;
  archived?: unknown;
}

/** Knowledgeの問題キューの状態（GET /api/review-queue/status）のうちHubが使う件数。 */
export interface KnowledgeReviewStatus {
  ready_due?: unknown;
  waiting_grading?: unknown;
  grading_errors?: unknown;
  unconfirmed_results?: unknown;
  generation_held?: unknown;
}

export interface DailyJournalRow {
  entry_date?: unknown;
  summary?: unknown;
  emotion_summary?: unknown;
  mood?: unknown;
  emotions?: unknown;
  themes?: unknown;
  entities?: unknown;
  categories?: unknown;
  source_pages?: unknown;
}

export type JournalMomentKey = "oneMonth" | "sixMonths" | "oneYear";

export interface JournalMoment {
  key: JournalMomentKey;
  label: string;
  targetDate: string;
  entry: null | {
    entryDate: string;
    daysBeforeTarget: number;
    summary: string;
    emotionSummary: string | null;
    mood: number | null;
    emotions: string[];
    themes: string[];
    entities: string[];
    categories: string[];
    sourcePageUrls: string[];
  };
}

export interface JournalTrend {
  startDate: string;
  endDate: string;
  days: Array<{ date: string; mood: number | null }>;
}

export interface QueryDefinition {
  table: TableName;
  select: string;
  order?: string;
  filters?: Record<string, string>;
}

export const DEFAULT_FINANCIAL_URL = "https://finance-9qq.pages.dev/";

export const DEFAULT_KNOWLEDGE_URL = "https://knowledge-50b.pages.dev/";

const FULL_AVAILABILITY: HubAvailability = {
  inbox: true,
  wants: true,
  focus: true,
  projects: true,
  writing: true,
  expenses: true,
  knowledge: true,
  journal: true,
  journalTrend: true,
  habits: true,
};

interface HabitOverview {
  summary: {
    active: number;
    completedToday: number;
    remainingToday: number;
  };
}

export class HubError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function queueCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function moodValue(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const parsed = integer(value);
  return parsed !== null && parsed >= -2 && parsed <= 2 ? parsed : null;
}

function date(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function plainDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function sourcePageUrls(value: unknown): string[] {
  const seen = new Set<string>();
  return textArray(value).flatMap((pageId) => {
    const compact = pageId.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(compact) || seen.has(compact)) return [];
    seen.add(compact);
    return [`https://app.notion.com/${compact}`];
  });
}

export function safeUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const parsed = new URL(candidate);
    const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    return parsed.protocol === "https:" || local ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function jstDateParts(now: Date) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  return {
    today: shifted.toISOString().slice(0, 10),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function subtractCalendarMonths(year: number, month: number, day: number, months: number): string {
  const monthStart = new Date(Date.UTC(year, month - months, 1));
  const targetYear = monthStart.getUTCFullYear();
  const targetMonth = monthStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function journalTargets(now = new Date()): Array<Omit<JournalMoment, "entry">> {
  const { year, month, day } = jstDateParts(now);
  return [
    { key: "oneMonth", label: "1か月前", targetDate: subtractCalendarMonths(year, month, day, 1) },
    { key: "sixMonths", label: "半年前", targetDate: subtractCalendarMonths(year, month, day, 6) },
    { key: "oneYear", label: "1年前", targetDate: subtractCalendarMonths(year, month, day, 12) },
  ];
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86_400_000);
}

export function journalTrendRange(now = new Date()): { startDate: string; endDate: string } {
  const endDate = jstDateParts(now).today;
  const startDate = new Date(Date.parse(`${endDate}T00:00:00.000Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function normalizeJournalTrend(rows: DailyJournalRow[], now = new Date()): JournalTrend {
  const { startDate, endDate } = journalTrendRange(now);
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const entryDate = plainDate(row.entry_date);
    const mood = moodValue(row.mood);
    if (entryDate && entryDate >= startDate && entryDate <= endDate && mood !== null) byDate.set(entryDate, mood);
  }
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const days = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return { date, mood: byDate.get(date) ?? null };
  });
  return { startDate, endDate, days };
}

export function normalizeJournalMoment(
  target: Omit<JournalMoment, "entry">,
  row: DailyJournalRow | null,
): JournalMoment {
  const entryDate = plainDate(row?.entry_date);
  if (!row || !entryDate || entryDate > target.targetDate) return { ...target, entry: null };
  const mood = moodValue(row.mood);
  return {
    ...target,
    entry: {
      entryDate,
      daysBeforeTarget: daysBetween(entryDate, target.targetDate),
      summary: text(row.summary) || "要約なし",
      emotionSummary: text(row.emotion_summary) || null,
      mood,
      emotions: textArray(row.emotions),
      themes: textArray(row.themes),
      entities: textArray(row.entities),
      categories: textArray(row.categories),
      sourcePageUrls: sourcePageUrls(row.source_pages),
    },
  };
}

export function emptyJournalMoments(now: Date): JournalMoment[] {
  return journalTargets(now).map((target) => ({ ...target, entry: null }));
}

function monthKey(value: string | null): string {
  return value?.slice(0, 7) || "";
}

function jstPlainDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeKnowledge(rows: KnowledgeRow[], today: string) {
  const items = rows
    .filter((row) => row.archived !== true)
    .map((row) => {
      const asked = integer(row.times_asked) ?? 0;
      const correct = integer(row.times_correct) ?? 0;
      const hasSuppliedAccuracy = typeof row.accuracy === "number"
        || (typeof row.accuracy === "string" && row.accuracy.trim() !== "");
      const suppliedAccuracy = Number(row.accuracy);
      const accuracy = hasSuppliedAccuracy && Number.isFinite(suppliedAccuracy)
        ? suppliedAccuracy
        : (asked > 0 ? Math.round((correct / asked) * 100) : null);
      const id = text(row.id);
      return {
        id,
        url: isUuid(id) ? `/knowledge/?knowledge=${encodeURIComponent(id)}` : "/knowledge/",
        title: text(row.title) || "タイトルなし",
        category: text(row.category) || "未分類",
        mastery: text(row.mastery) || "未学習",
        timesAsked: asked,
        accuracy,
        nextReviewOn: typeof row.next_review_on === "string" ? row.next_review_on : null,
        createdAt: date(row.created_at),
      };
    });
  const byWeakness = [...items]
    .filter((item) => item.timesAsked > 0 && item.accuracy !== null && item.accuracy < 80)
    .sort((left, right) => (left.accuracy ?? 101) - (right.accuracy ?? 101) || right.timesAsked - left.timesAsked);
  const byDue = [...items]
    .filter((item) => item.nextReviewOn !== null && item.nextReviewOn <= today)
    .sort((left, right) => (left.nextReviewOn || "").localeCompare(right.nextReviewOn || ""));
  const byNewest = [...items].sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));

  const selected: Array<(typeof items)[number] & { reason: "weak" | "due" | "new" }> = [];
  const used = new Set<string>();
  const add = (item: (typeof items)[number], reason: "weak" | "due" | "new") => {
    if (!item.id || used.has(item.id) || selected.length >= 5) return;
    used.add(item.id);
    selected.push({ ...item, reason });
  };
  byWeakness.slice(0, 2).forEach((item) => add(item, "weak"));
  byDue.slice(0, 2).forEach((item) => add(item, "due"));
  byNewest.slice(0, 3).forEach((item) => add(item, "new"));
  byNewest.forEach((item) => add(item, "new"));

  return {
    dueCount: byDue.length,
    weakCount: byWeakness.length,
    items: selected,
  };
}

export function normalizeHub(
  inboxRows: InboxRow[],
  wantRows: WantRow[],
  expenseRows: ExpenseRow[],
  knowledgeRows: KnowledgeRow[],
  _env: HubEnv = {},
  now = new Date(),
  availability: HubAvailability = FULL_AVAILABILITY,
  journalMoments: JournalMoment[] = emptyJournalMoments(now),
  habitOverview: HabitOverview | null = null,
  focusRows: FocusRow[] = [],
  reviewStatus: KnowledgeReviewStatus | null = null,
  projectRows: ProjectRow[] = [],
  writingRows: WritingRow[] = [],
  journalTrend: JournalTrend = normalizeJournalTrend([], now),
  reviewBatches: ReviewBatchesStatus | null = null,
  databaseUsage: DatabaseUsage | null = null,
) {
  const { today, year, month } = jstDateParts(now);
  const currentMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
  const previousDate = new Date(Date.UTC(year, month - 1, 1));
  const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const pendingInbox = inboxRows
    .map((row) => {
      const id = integer(row.id);
      const createdAt = date(row.created_at);
      const createdDate = jstPlainDate(createdAt);
      return {
        id,
        url: id !== null && id > 0 ? `/compass/?view=inbox&id=${id}` : "/compass/?view=inbox",
        content: text(row.content) || "内容なし",
        status: text(row.status).toLowerCase(),
        createdAt,
        ageDays: createdDate ? Math.max(0, daysBetween(createdDate, today)) : null,
      };
    })
    .filter((item) => item.status === "pending")
    .sort((left, right) => (left.createdAt || "9999").localeCompare(right.createdAt || "9999") || (left.id ?? 0) - (right.id ?? 0));
  const wants = wantRows.map((row) => {
    return {
      status: text(row.status).toLowerCase(),
      type: text(row.type).toLowerCase() || "want",
      revisitOn: plainDate(row.revisit_on),
    };
  });
  const activeWants = wants
    .filter((want) => want.status === "active");
  // 未整理は再訪日が来たWantだけ。再訪日の無いWantはバックログなので数えない。
  const untriagedWants = activeWants
    .filter((want) => want.type !== "wish" && want.revisitOn !== null && want.revisitOn <= today);
  const focus = normalizeFocusRows(focusRows)
    .filter((item) => item.status === "active")
    .slice(0, FOCUS_LIMIT);
  const activeProjects = projectRows.filter((row) => ["active", "waiting", "on_hold"].includes(text(row.status).toLowerCase()));
  const writingIdeas = writingRows.filter((row) => text(row.status).toLowerCase() === "candidate");
  const expenses = expenseRows.map((row) => ({
    id: integer(row.id),
    transactionDate: typeof row.transaction_date === "string" ? row.transaction_date : null,
    amount: number(row.amount),
    title: text(row.title) || "名称なし",
    category: text(row.category) || "未分類",
    payer: text(row.payer) || null,
    createdAt: date(row.created_at),
  }));
  const currentSpend = expenses
    .filter((item) => monthKey(item.transactionDate) === currentMonth && item.amount > 0 && !item.category.startsWith("80_"))
    .reduce((sum, item) => sum + item.amount, 0);
  const previousSpend = expenses
    .filter((item) => monthKey(item.transactionDate) === previousMonth && item.amount > 0 && !item.category.startsWith("80_"))
    .reduce((sum, item) => sum + item.amount, 0);
  const knowledge = normalizeKnowledge(knowledgeRows, today);
  const unavailable = (Object.entries(availability) as Array<[keyof HubAvailability, boolean]>)
    .filter(([, available]) => !available)
    .map(([name]) => name);

  return {
    app: { appId: "personal-hub", version: "1.0.0", mode: "read-write" },
    source: { system: "personal-hub", state: unavailable.length ? "partial" : "live", fetchedAt: now.toISOString(), unavailable },
    availability,
    navigation: {
      compass: "/compass/",
      projects: "/projects/",
      writing: "/writing/",
      financial: "/finance/",
      knowledge: "/knowledge/",
      knowledgeReview: "/knowledge/?view=quiz&mode=daily",
      knowledgeLog: "/knowledge/?view=log",
      habits: "/habits/",
    },
    summary: {
      currentMonthSpend: availability.expenses ? currentSpend : null,
      previousMonthSpend: availability.expenses ? previousSpend : null,
      pendingInbox: availability.inbox ? pendingInbox.length : null,
      dueKnowledge: availability.knowledge ? knowledge.dueCount : null,
      knowledgeAnsweredToday: null as number | null,
      knowledgeAnsweredOn: null as string | null,
      // 問題キューの件数。すぐ解ける問題（期限が来た出題待ち）を主に、採点待ちと未確認の採点結果を添える。
      reviewReadyDue: availability.knowledge ? queueCount(reviewStatus?.ready_due) : null,
      reviewWaitingGrading: availability.knowledge ? queueCount(reviewStatus?.waiting_grading) : null,
      reviewGradingErrors: availability.knowledge ? queueCount(reviewStatus?.grading_errors) : null,
      reviewUnconfirmed: availability.knowledge ? queueCount(reviewStatus?.unconfirmed_results) : null,
      reviewGenerationHeld: availability.knowledge ? queueCount(reviewStatus?.generation_held) : null,
      // 生成・採点バッチの警告（全体の失敗が続く・成功が途絶える・cronが止まる）。取得できなければnull。
      reviewBatchAlerts: reviewBatches ? reviewBatches.alerts : null,
      // SupabaseのDB容量が逼迫しているときの警告。取得できない・余裕があるときはnull。
      databaseAlert: databaseUsage?.alert ?? null,
      weakKnowledge: availability.knowledge ? knowledge.weakCount : null,
      activeWants: availability.wants ? activeWants.length : null,
      untriagedWants: availability.wants ? untriagedWants.length : null,
      activeProjects: availability.projects ? activeProjects.length : null,
      writingIdeas: availability.writing ? writingIdeas.length : null,
      activeHabits: availability.habits !== false ? habitOverview?.summary.active ?? 0 : null,
      completedHabitsToday: availability.habits !== false ? habitOverview?.summary.completedToday ?? 0 : null,
      remainingHabitsToday: availability.habits !== false ? habitOverview?.summary.remainingToday ?? 0 : null,
      activeFocus: availability.focus ? focus.length : null,
    },
    recentExpenses: expenses
      .sort((left, right) => (right.transactionDate || "").localeCompare(left.transactionDate || "") || (right.id ?? 0) - (left.id ?? 0))
      .slice(0, 5),
    knowledge: knowledge.items,
    inbox: pendingInbox.slice(0, 3),
    focus,
    journalMoments,
    journalTrend,
    selection: {
      knowledge: "苦手を最大2件、復習期限、新規ナレッジの順で重複を除いて選定",
      inbox: "未整理のInboxを古い順で最大3件表示",
      focus: "手動で選んだActive Focusを並び順どおり最大5件表示",
      journal: "各基準日以前で最も近いdaily_journalを選定",
    },
  };
}

/** Hubが使う支出（今月・先月の合計と最近の5件）に必要な、先月1日（JST）。全期間は取らない。 */
export function expenseWindowStart(now: Date): string {
  const { year, month } = jstDateParts(now);
  const start = new Date(Date.UTC(year, month - 1, 1));
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
