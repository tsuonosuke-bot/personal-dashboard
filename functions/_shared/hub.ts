import type { DashboardEnv } from "./dashboard.ts";
import { loadHabits } from "./habits.ts";

export interface HubEnv extends DashboardEnv {
  HUB_SERVICE_TOKEN?: string;
}

export interface HubAvailability {
  inbox: boolean;
  wants: boolean;
  expenses: boolean;
  knowledge: boolean;
  journal: boolean;
  habits?: boolean;
}

type TableName = "idea_inbox" | "wants" | "expenses" | "knowledge" | "daily_journal";

interface InboxRow { status?: unknown }
interface WantRow { id?: unknown; content?: unknown; status?: unknown; created_at?: unknown }
interface ExpenseRow {
  id?: unknown;
  transaction_date?: unknown;
  amount?: unknown;
  title?: unknown;
  category?: unknown;
  payer?: unknown;
  created_at?: unknown;
}
interface KnowledgeRow {
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
interface DailyJournalRow {
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

interface QueryDefinition {
  table: TableName;
  select: string;
  order?: string;
  filters?: Record<string, string>;
}

const PAGE_SIZE = 1_000;
const DEFAULT_FINANCIAL_URL = "https://financial-dashboard-9q8.pages.dev/";
const DEFAULT_KNOWLEDGE_URL = "https://knowledge-dashboard-27t.pages.dev/";
const FULL_AVAILABILITY: HubAvailability = {
  inbox: true,
  wants: true,
  expenses: true,
  knowledge: true,
  journal: true,
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

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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

function safeUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const parsed = new URL(candidate);
    const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    return parsed.protocol === "https:" || local ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function connection(env: HubEnv): { url: URL; key: string } {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new HubError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HubError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new HubError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { url, key };
}

async function fetchRows(env: HubEnv, query: QueryDefinition): Promise<unknown[]> {
  const { url, key } = connection(env);
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${query.table}`, url);
    endpoint.searchParams.set("select", query.select);
    if (query.order) endpoint.searchParams.set("order", query.order);
    for (const [name, value] of Object.entries(query.filters || {})) endpoint.searchParams.set(name, value);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    let response: Response;
    try {
      response = await fetch(endpoint, { headers: { Accept: "application/json", apikey: key } });
    } catch {
      throw new HubError("SUPABASE_UNAVAILABLE", `Could not reach ${query.table}.`);
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED";
      throw new HubError(code, `${query.table} returned ${response.status}.`);
    }
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new HubError("SUPABASE_RESPONSE_INVALID", `${query.table} returned invalid data.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchDashboardRows(env: HubEnv, baseUrl: string, path: string): Promise<unknown[]> {
  const token = env.HUB_SERVICE_TOKEN?.trim();
  if (!token || token.length < 32) throw new HubError("HUB_SERVICE_NOT_CONFIGURED", "Hub service token is not configured.", 503);
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(path, baseUrl);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Accept: "application/json", "X-Hub-Service": token },
      });
    } catch {
      throw new HubError("HUB_SERVICE_UNAVAILABLE", `Could not reach ${endpoint.host}.`);
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "HUB_SERVICE_ACCESS_DENIED"
        : "HUB_SERVICE_REQUEST_FAILED";
      throw new HubError(code, `${endpoint.host} returned ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { items?: unknown }).items)) {
      throw new HubError("HUB_SERVICE_RESPONSE_INVALID", `${endpoint.host} returned invalid data.`);
    }
    const page = (payload as { items: unknown[] }).items;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchLatestJournal(env: HubEnv, targetDate: string): Promise<DailyJournalRow | null> {
  const { url, key } = connection(env);
  const endpoint = new URL("/rest/v1/daily_journal", url);
  endpoint.searchParams.set(
    "select",
    "entry_date,summary,emotion_summary,mood,emotions,themes,entities,categories,source_pages",
  );
  endpoint.searchParams.set("entry_date", `lte.${targetDate}`);
  endpoint.searchParams.set("order", "entry_date.desc");
  endpoint.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Accept: "application/json", apikey: key } });
  } catch {
    throw new HubError("SUPABASE_UNAVAILABLE", "Could not reach daily_journal.");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "SUPABASE_ACCESS_DENIED"
      : "SUPABASE_REQUEST_FAILED";
    throw new HubError(code, `daily_journal returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new HubError("SUPABASE_RESPONSE_INVALID", "daily_journal returned invalid data.");
  return (rows[0] as DailyJournalRow | undefined) ?? null;
}

async function loadJournalMoments(env: HubEnv, now: Date): Promise<JournalMoment[]> {
  const targets = journalTargets(now);
  const rows = await Promise.all(targets.map((target) => fetchLatestJournal(env, target.targetDate)));
  return targets.map((target, index) => normalizeJournalMoment(target, rows[index]));
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

export function normalizeJournalMoment(
  target: Omit<JournalMoment, "entry">,
  row: DailyJournalRow | null,
): JournalMoment {
  const entryDate = plainDate(row?.entry_date);
  if (!row || !entryDate || entryDate > target.targetDate) return { ...target, entry: null };
  const mood = integer(row.mood);
  return {
    ...target,
    entry: {
      entryDate,
      daysBeforeTarget: daysBetween(entryDate, target.targetDate),
      summary: text(row.summary) || "要約なし",
      emotionSummary: text(row.emotion_summary) || null,
      mood: mood !== null && mood >= -2 && mood <= 2 ? mood : null,
      emotions: textArray(row.emotions),
      themes: textArray(row.themes),
      entities: textArray(row.entities),
      categories: textArray(row.categories),
      sourcePageUrls: sourcePageUrls(row.source_pages),
    },
  };
}

function emptyJournalMoments(now: Date): JournalMoment[] {
  return journalTargets(now).map((target) => ({ ...target, entry: null }));
}

function monthKey(value: string | null): string {
  return value?.slice(0, 7) || "";
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
      return {
        id: text(row.id),
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
) {
  const { today, year, month } = jstDateParts(now);
  const currentMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
  const previousDate = new Date(Date.UTC(year, month - 1, 1));
  const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const wants = wantRows.map((row) => ({
    id: integer(row.id),
    content: text(row.content) || "内容なし",
    status: text(row.status).toLowerCase(),
    createdAt: date(row.created_at),
  }));
  const activeWants = wants
    .filter((want) => want.status === "active")
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || "") || (right.id ?? 0) - (left.id ?? 0));
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
    app: { appId: "personal-hub", version: "1.0.0", mode: "read-only" },
    source: { system: "personal-hub", state: unavailable.length ? "partial" : "live", fetchedAt: now.toISOString(), unavailable },
    availability,
    navigation: {
      compass: "/compass/",
      financial: "/go/financial",
      knowledge: "/go/knowledge",
      knowledgeReview: "/go/knowledge?view=quiz",
      habits: "/habits/",
    },
    summary: {
      currentMonthSpend: availability.expenses ? currentSpend : null,
      previousMonthSpend: availability.expenses ? previousSpend : null,
      pendingInbox: availability.inbox ? inboxRows.filter((row) => text(row.status).toLowerCase() === "pending").length : null,
      dueKnowledge: availability.knowledge ? knowledge.dueCount : null,
      weakKnowledge: availability.knowledge ? knowledge.weakCount : null,
      activeWants: availability.wants ? activeWants.length : null,
      activeHabits: availability.habits !== false ? habitOverview?.summary.active ?? 0 : null,
      completedHabitsToday: availability.habits !== false ? habitOverview?.summary.completedToday ?? 0 : null,
      remainingHabitsToday: availability.habits !== false ? habitOverview?.summary.remainingToday ?? 0 : null,
    },
    recentExpenses: expenses
      .sort((left, right) => (right.transactionDate || "").localeCompare(left.transactionDate || "") || (right.id ?? 0) - (left.id ?? 0))
      .slice(0, 5),
    knowledge: knowledge.items,
    wants: activeWants.slice(0, 3),
    journalMoments,
    selection: {
      knowledge: "苦手を最大2件、復習期限、新規ナレッジの順で重複を除いて選定",
      wants: "作成日時の新しいActive Wantsから最大3件を選定",
      journal: "各基準日以前で最も近いdaily_journalを選定",
    },
  };
}

export async function loadHub(env: HubEnv, now = new Date()) {
  const financialUrl = safeUrl(env.NAV_FINANCIAL_URL, DEFAULT_FINANCIAL_URL);
  const knowledgeUrl = safeUrl(env.NAV_KNOWLEDGE_URL, DEFAULT_KNOWLEDGE_URL);
  const [inbox, wants, expenses, knowledge, journal, habits] = await Promise.allSettled([
    fetchRows(env, { table: "idea_inbox", select: "status" }) as Promise<InboxRow[]>,
    fetchRows(env, { table: "wants", select: "id,content,status,created_at", order: "created_at.desc,id.desc" }) as Promise<WantRow[]>,
    fetchDashboardRows(env, financialUrl, "/api/expenses") as Promise<ExpenseRow[]>,
    fetchDashboardRows(env, knowledgeUrl, "/api/knowledge") as Promise<KnowledgeRow[]>,
    loadJournalMoments(env, now),
    loadHabits(env, now),
  ] as const);
  const results = { inbox, wants, expenses, knowledge, journal, habits };
  const availability: HubAvailability = {
    inbox: inbox.status === "fulfilled",
    wants: wants.status === "fulfilled",
    expenses: expenses.status === "fulfilled",
    knowledge: knowledge.status === "fulfilled",
    journal: journal.status === "fulfilled",
    habits: habits.status === "fulfilled",
  };
  for (const [name, result] of Object.entries(results)) {
    if (result.status === "rejected") {
      const code = result.reason instanceof HubError ? result.reason.code : "UNKNOWN";
      console.error(`hub ${name} load failed: ${code}`);
    }
  }
  const rejected = Object.values(results).filter((result) => result.status === "rejected");
  if (rejected.length === Object.keys(results).length) throw rejected[0].reason;
  return normalizeHub(
    inbox.status === "fulfilled" ? inbox.value : [],
    wants.status === "fulfilled" ? wants.value : [],
    expenses.status === "fulfilled" ? expenses.value : [],
    knowledge.status === "fulfilled" ? knowledge.value : [],
    env,
    now,
    availability,
    journal.status === "fulfilled" ? journal.value : emptyJournalMoments(now),
    habits.status === "fulfilled" ? habits.value : null,
  );
}

export function publicHubError(error: unknown) {
  const code = error instanceof HubError ? error.code : "HUB_LOAD_FAILED";
  const status = error instanceof HubError ? error.status : 502;
  const messages: Record<string, string> = {
    SUPABASE_NOT_CONFIGURED: "サーバーのSupabase接続設定が未完了です。",
    HUB_SERVICE_NOT_CONFIGURED: "Hub用の読み取り接続設定が未完了です。",
    HUB_SERVICE_ACCESS_DENIED: "家計簿またはナレッジへのHub読取が許可されていません。",
    HUB_SERVICE_UNAVAILABLE: "家計簿またはナレッジへ接続できませんでした。",
    HUB_SERVICE_REQUEST_FAILED: "家計簿またはナレッジからデータを取得できませんでした。",
    HUB_SERVICE_RESPONSE_INVALID: "家計簿またはナレッジから想定外の応答を受信しました。",
    SUPABASE_CONFIG_INVALID: "サーバーのSupabase接続設定が正しくありません。",
    SUPABASE_ACCESS_DENIED: "Supabaseへの読取権限がありません。",
    SUPABASE_UNAVAILABLE: "Supabaseへ接続できませんでした。",
    SUPABASE_REQUEST_FAILED: "Supabaseからデータを取得できませんでした。",
    SUPABASE_RESPONSE_INVALID: "Supabaseから想定外の応答を受信しました。",
  };
  return { code, status, message: messages[code] || "Hubを読み込めませんでした。" };
}
