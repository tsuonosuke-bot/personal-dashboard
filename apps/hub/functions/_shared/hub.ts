/** Hub orchestration: independent sources may fail without discarding successful sections. */
import { type HubEnv, type InboxRow, type ExpenseRow, type KnowledgeRow, type KnowledgeReviewStatus, type HubAvailability, HubError, normalizeHub, emptyJournalMoments, normalizeJournalTrend } from "./hubModel.ts";
import { externalDashboardBase } from "./dashboardInternal.ts";
import { loadDatabaseUsage } from "./databaseUsage.ts";
import {
  fetchLocalHubSummary,
  sourceDeadline,
  fetchDashboardJson,
  loadJournalMoments,
  loadJournalTrend,
} from "./hubSources.ts";
import { readReviewBatches } from "./reviewBatches.ts";
import { type FocusRow } from "./focus.ts";
import { type HomeSection } from "./homeSettings.ts";

/** 各取得元を使うホームの欄。その欄がすべて非表示なら読まない。警告に使う取得元（knowledgeStatus・DB容量）は常に読む。 */
export const HUB_SOURCE_SECTIONS = {
  inbox: ["apps", "learning", "inbox"],
  wants: ["apps", "inbox"],
  focus: ["focus"],
  projects: ["apps", "learning"],
  writing: ["apps"],
  expenses: ["apps", "expenses"],
  knowledge: ["apps", "learning", "knowledge"],
  journal: ["journal"],
  journalTrend: ["journal"],
  habits: ["apps"],
} as const satisfies Record<string, readonly HomeSection[]>;
type SkippableSource = keyof typeof HUB_SOURCE_SECTIONS;

export function skippedHubSources(hidden: readonly HomeSection[]): SkippableSource[] {
  return (Object.keys(HUB_SOURCE_SECTIONS) as SkippableSource[])
    .filter((source) => HUB_SOURCE_SECTIONS[source].every((section) => hidden.includes(section)));
}

interface KnowledgeHubSummary { dueCount: number; weakCount: number; items: KnowledgeRow[]; reviewStatus: KnowledgeReviewStatus; date?: unknown; todayAnswered?: unknown }
interface FinanceHubSummary { currentMonthSpend: number; previousMonthSpend: number; recentExpenses: ExpenseRow[] }

function validRemoteSummary<T>(value: unknown, counts: string[], array: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Invalid summary.");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row[array]) || counts.some((name) => typeof row[name] !== "number" || !Number.isFinite(row[name]))) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Invalid summary fields.");
  if (array === "items" && (!row.reviewStatus || typeof row.reviewStatus !== "object" || Array.isArray(row.reviewStatus))) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Missing review queue counts.");
  return value as T;
}

export async function loadHub(env: HubEnv, now = new Date(), options: { sourceTimeoutMs?: number; hidden?: readonly HomeSection[] } = {}) {
  const financialUrl = externalDashboardBase(env.NAV_FINANCIAL_URL);
  const knowledgeUrl = externalDashboardBase(env.NAV_KNOWLEDGE_URL);
  // DB容量は失敗してもnullで返るので、「すべての取得元が失敗したら503」の判定（results）には入れない。
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timeout = Math.max(1, Math.min(6_000, options.sourceTimeoutMs ?? 6_000));
  const databaseUsage = sourceDeadline(loadDatabaseUsage(env), timeout).catch(() => null);
  const skipped = skippedHubSources(options.hidden ?? []);
  const unlessSkipped = <T>(source: SkippableSource, work: () => Promise<T>): Promise<T> =>
    skipped.includes(source) ? Promise.reject(new HubError("HUB_SOURCE_SKIPPED", `${source} is hidden.`)) : work();
  const [inbox, wants, focus, projects, writing, expenses, knowledge, knowledgeStatus, journal, journalTrend, habits] = await Promise.allSettled([
    unlessSkipped("inbox", () => fetchLocalHubSummary(env, "inbox", today)),
    unlessSkipped("wants", () => fetchLocalHubSummary(env, "wants", today)),
    unlessSkipped("focus", () => fetchLocalHubSummary(env, "focus", today)),
    unlessSkipped("projects", () => fetchLocalHubSummary(env, "projects", today)),
    unlessSkipped("writing", () => fetchLocalHubSummary(env, "writing", today)),
    unlessSkipped("expenses", () => fetchDashboardJson(env, "finance", financialUrl, `/api/hub-summary?today=${today}`).then((value) => validRemoteSummary<FinanceHubSummary>(value, ["currentMonthSpend", "previousMonthSpend"], "recentExpenses"))),
    unlessSkipped("knowledge", () => fetchDashboardJson(env, "knowledge", knowledgeUrl, `/api/hub-summary?today=${today}`).then((value) => validRemoteSummary<KnowledgeHubSummary>(value, ["dueCount", "weakCount"], "items"))),
    fetchDashboardJson(env, "knowledge", knowledgeUrl, "/api/status"),
    unlessSkipped("journal", () => loadJournalMoments(env, now)),
    unlessSkipped("journalTrend", () => loadJournalTrend(env, now)),
    unlessSkipped("habits", () => fetchLocalHubSummary(env, "habits", today)),
  ].map((work) => sourceDeadline(work, timeout)) as [Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>, Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>, Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>, Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>, Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>, Promise<FinanceHubSummary>, Promise<KnowledgeHubSummary>, Promise<unknown>, Promise<Awaited<ReturnType<typeof loadJournalMoments>>>, Promise<Awaited<ReturnType<typeof loadJournalTrend>>>, Promise<Awaited<ReturnType<typeof fetchLocalHubSummary>>>]);
  const results = { inbox, wants, focus, projects, writing, expenses, knowledge, knowledgeStatus, journal, journalTrend, habits };
  const availability: HubAvailability = {
    inbox: inbox.status === "fulfilled",
    wants: wants.status === "fulfilled",
    focus: focus.status === "fulfilled",
    projects: projects.status === "fulfilled",
    writing: writing.status === "fulfilled",
    expenses: expenses.status === "fulfilled",
    knowledge: knowledge.status === "fulfilled",
    journal: journal.status === "fulfilled",
    journalTrend: journalTrend.status === "fulfilled",
    habits: habits.status === "fulfilled",
  };
  // 非表示で読まなかった取得元は失敗に数えない。
  const loaded = Object.entries(results).filter(([name]) => !skipped.includes(name as SkippableSource));
  for (const [name, result] of loaded) {
    if (result.status === "rejected") {
      const code = result.reason instanceof HubError ? result.reason.code : "UNKNOWN";
      console.error(`hub ${name} load failed: ${code}`);
    }
  }
  const rejected = loaded.filter(([, result]) => result.status === "rejected") as Array<[string, PromiseRejectedResult]>;
  if (rejected.length === loaded.length) throw rejected[0][1].reason;
  const result = normalizeHub(
    inbox.status === "fulfilled" ? inbox.value.items as InboxRow[] : [],
    [],
    expenses.status === "fulfilled" ? expenses.value.recentExpenses : [],
    knowledge.status === "fulfilled" ? knowledge.value.items : [],
    env,
    now,
    availability,
    journal.status === "fulfilled" ? journal.value : emptyJournalMoments(now),
    habits.status === "fulfilled" ? { summary: habits.value.summary! } : null,
    focus.status === "fulfilled" ? focus.value.items as FocusRow[] : [],
    knowledge.status === "fulfilled" ? knowledge.value.reviewStatus : null,
    [],
    [],
    journalTrend.status === "fulfilled" ? journalTrend.value : normalizeJournalTrend([], now),
    knowledgeStatus.status === "fulfilled" ? readReviewBatches(knowledgeStatus.value) : null,
    await databaseUsage,
  );
  if (inbox.status === "fulfilled") result.summary.pendingInbox = inbox.value.pendingInbox!;
  if (wants.status === "fulfilled") { result.summary.activeWants = wants.value.activeWants!; result.summary.untriagedWants = wants.value.untriagedWants!; }
  if (projects.status === "fulfilled") result.summary.activeProjects = projects.value.activeProjects!;
  if (writing.status === "fulfilled") result.summary.writingIdeas = writing.value.writingIdeas!;
  if (expenses.status === "fulfilled") { result.summary.currentMonthSpend = expenses.value.currentMonthSpend; result.summary.previousMonthSpend = expenses.value.previousMonthSpend; }
  if (knowledge.status === "fulfilled") {
    result.summary.dueKnowledge = knowledge.value.dueCount;
    result.summary.weakKnowledge = knowledge.value.weakCount;
    const value = knowledge.value;
    if (value.date === today && typeof value.todayAnswered === 'number' && Number.isSafeInteger(value.todayAnswered) && value.todayAnswered >= 0) {
      result.summary.knowledgeAnsweredToday = value.todayAnswered;
      result.summary.knowledgeAnsweredOn = today;
    }
  }
  if (!skipped.length) return result;
  const unavailable = result.source.unavailable.filter((name) => !skipped.includes(name as SkippableSource));
  return { ...result, source: { ...result.source, state: unavailable.length ? "partial" : "live", unavailable, skipped } };
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

export {
  type HubEnv,
  type HubAvailability,
  type JournalMomentKey,
  type JournalMoment,
  type JournalTrend,
  HubError,
  journalTargets,
  journalTrendRange,
  normalizeJournalTrend,
  normalizeJournalMoment,
  normalizeHub,
  expenseWindowStart,
} from "./hubModel.ts";
