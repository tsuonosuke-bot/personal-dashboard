/** Hub orchestration: independent sources may fail without discarding successful sections. */
import { type HubEnv, safeUrl, DEFAULT_FINANCIAL_URL, DEFAULT_KNOWLEDGE_URL, type InboxRow, type ExpenseRow, type KnowledgeRow, type KnowledgeReviewStatus, type HubAvailability, HubError, normalizeHub, emptyJournalMoments, normalizeJournalTrend } from "./hubModel.ts";
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

interface KnowledgeHubSummary { dueCount: number; weakCount: number; items: KnowledgeRow[]; reviewStatus: KnowledgeReviewStatus }
interface FinanceHubSummary { currentMonthSpend: number; previousMonthSpend: number; recentExpenses: ExpenseRow[] }

function validRemoteSummary<T>(value: unknown, counts: string[], array: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Invalid summary.");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row[array]) || counts.some((name) => typeof row[name] !== "number" || !Number.isFinite(row[name]))) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Invalid summary fields.");
  if (array === "items" && (!row.reviewStatus || typeof row.reviewStatus !== "object" || Array.isArray(row.reviewStatus))) throw new HubError("HUB_SERVICE_RESPONSE_INVALID", "Missing review queue counts.");
  return value as T;
}

export async function loadHub(env: HubEnv, now = new Date(), options: { sourceTimeoutMs?: number } = {}) {
  const financialUrl = safeUrl(env.NAV_FINANCIAL_URL, DEFAULT_FINANCIAL_URL);
  const knowledgeUrl = safeUrl(env.NAV_KNOWLEDGE_URL, DEFAULT_KNOWLEDGE_URL);
  // DB容量は失敗してもnullで返るので、「すべての取得元が失敗したら503」の判定（results）には入れない。
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timeout = Math.max(1, Math.min(6_000, options.sourceTimeoutMs ?? 6_000));
  const databaseUsage = sourceDeadline(loadDatabaseUsage(env), timeout).catch(() => null);
  const [inbox, wants, focus, projects, writing, expenses, knowledge, knowledgeStatus, journal, journalTrend, habits] = await Promise.allSettled([
    fetchLocalHubSummary(env, "inbox", today),
    fetchLocalHubSummary(env, "wants", today),
    fetchLocalHubSummary(env, "focus", today),
    fetchLocalHubSummary(env, "projects", today),
    fetchLocalHubSummary(env, "writing", today),
    fetchDashboardJson(env, financialUrl, `/api/hub-summary?today=${today}`).then((value) => validRemoteSummary<FinanceHubSummary>(value, ["currentMonthSpend", "previousMonthSpend"], "recentExpenses")),
    fetchDashboardJson(env, knowledgeUrl, `/api/hub-summary?today=${today}`).then((value) => validRemoteSummary<KnowledgeHubSummary>(value, ["dueCount", "weakCount"], "items")),
    fetchDashboardJson(env, knowledgeUrl, "/api/status"),
    loadJournalMoments(env, now),
    loadJournalTrend(env, now),
    fetchLocalHubSummary(env, "habits", today),
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
  for (const [name, result] of Object.entries(results)) {
    if (result.status === "rejected") {
      const code = result.reason instanceof HubError ? result.reason.code : "UNKNOWN";
      console.error(`hub ${name} load failed: ${code}`);
    }
  }
  const rejected = Object.values(results).filter((result) => result.status === "rejected");
  if (rejected.length === Object.keys(results).length) throw rejected[0].reason;
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
  if (knowledge.status === "fulfilled") { result.summary.dueKnowledge = knowledge.value.dueCount; result.summary.weakKnowledge = knowledge.value.weakCount; }
  return result;
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
