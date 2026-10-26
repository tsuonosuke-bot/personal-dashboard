/** Hub orchestration: independent sources may fail without discarding successful sections. */
import { type HubEnv, safeUrl, DEFAULT_FINANCIAL_URL, DEFAULT_KNOWLEDGE_URL, type InboxRow, type WantRow, type ProjectRow, type WritingRow, expenseWindowStart, type ExpenseRow, type KnowledgeRow, type KnowledgeReviewStatus, type HubAvailability, HubError, normalizeHub, emptyJournalMoments, normalizeJournalTrend } from "./hubModel.ts";
import { loadDatabaseUsage } from "./databaseUsage.ts";
import {
  fetchRows,
  fetchFocusRows,
  fetchDashboardRows,
  fetchDashboardJson,
  loadJournalMoments,
  loadJournalTrend,
} from "./hubSources.ts";
import { loadHabits } from "./habits.ts";
import { readReviewBatches } from "./reviewBatches.ts";

export async function loadHub(env: HubEnv, now = new Date()) {
  const financialUrl = safeUrl(env.NAV_FINANCIAL_URL, DEFAULT_FINANCIAL_URL);
  const knowledgeUrl = safeUrl(env.NAV_KNOWLEDGE_URL, DEFAULT_KNOWLEDGE_URL);
  // DB容量は失敗してもnullで返るので、「すべての取得元が失敗したら503」の判定（results）には入れない。
  const databaseUsage = loadDatabaseUsage(env);
  const [inbox, wants, focus, projects, writing, expenses, knowledge, reviewStatus, knowledgeStatus, journal, journalTrend, habits] = await Promise.allSettled([
    fetchRows(env, { table: "idea_inbox", select: "id,content,status,created_at", order: "created_at.desc,id.desc" }) as Promise<InboxRow[]>,
    fetchRows(env, { table: "wants", select: "status,type,revisit_on" }) as Promise<WantRow[]>,
    fetchFocusRows(env),
    fetchRows(env, { table: "projects", select: "status" }) as Promise<ProjectRow[]>,
    fetchRows(env, { table: "writing_topics", select: "status" }) as Promise<WritingRow[]>,
    fetchDashboardRows(env, financialUrl, `/api/expenses?from=${expenseWindowStart(now)}`) as Promise<ExpenseRow[]>,
    fetchDashboardRows(env, knowledgeUrl, "/api/knowledge") as Promise<KnowledgeRow[]>,
    fetchDashboardJson(env, knowledgeUrl, "/api/review-queue/status") as Promise<KnowledgeReviewStatus>,
    fetchDashboardJson(env, knowledgeUrl, "/api/status"),
    loadJournalMoments(env, now),
    loadJournalTrend(env, now),
    loadHabits(env, now),
  ] as const);
  const results = { inbox, wants, focus, projects, writing, expenses, knowledge, reviewStatus, knowledgeStatus, journal, journalTrend, habits };
  const availability: HubAvailability = {
    inbox: inbox.status === "fulfilled",
    wants: wants.status === "fulfilled",
    focus: focus.status === "fulfilled",
    projects: projects.status === "fulfilled",
    writing: writing.status === "fulfilled",
    expenses: expenses.status === "fulfilled",
    knowledge: knowledge.status === "fulfilled" && reviewStatus.status === "fulfilled",
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
    focus.status === "fulfilled" ? focus.value : [],
    reviewStatus.status === "fulfilled" ? reviewStatus.value : null,
    projects.status === "fulfilled" ? projects.value : [],
    writing.status === "fulfilled" ? writing.value : [],
    journalTrend.status === "fulfilled" ? journalTrend.value : normalizeJournalTrend([], now),
    knowledgeStatus.status === "fulfilled" ? readReviewBatches(knowledgeStatus.value) : null,
    await databaseUsage,
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
