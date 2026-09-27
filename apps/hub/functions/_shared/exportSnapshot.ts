import type { HubEnv } from "./hub.ts";

const PAGE_SIZE = 1_000;
const DEFAULT_FINANCIAL_URL = "https://financial-dashboard-9q8.pages.dev/";
const DEFAULT_KNOWLEDGE_URL = "https://knowledge-dashboard-27t.pages.dev/";
const PERSONAL_TABLES = [
  "idea_inbox",
  "wants",
  "want_routes",
  "writing_topics",
  "habits",
  "habit_logs",
  "focus_items",
  "projects",
  "project_items",
  "project_actions",
  "scheduled_actions",
  "scheduled_action_schedule_history",
  "daily_journal",
] as const;

class ExportError extends Error {}

function supabaseConnection(env: HubEnv): { base: URL; key: string } {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new ExportError("Personal DB connection is not configured.");
  try {
    return { base: new URL(rawUrl), key };
  } catch {
    throw new ExportError("Personal DB connection is invalid.");
  }
}

async function fetchAllTableRows(env: HubEnv, table: string): Promise<unknown[]> {
  const { base, key } = supabaseConnection(env);
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, base);
    endpoint.searchParams.set("select", "*");
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const response = await fetch(endpoint, { headers: { Accept: "application/json", apikey: key } });
    if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("json")) {
      throw new ExportError(`Personal export failed for ${table}.`);
    }
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new ExportError(`Personal export returned invalid data for ${table}.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchRemoteExport(env: HubEnv, baseUrl: string): Promise<unknown> {
  const token = env.HUB_SERVICE_TOKEN?.trim();
  if (!token || token.length < 32) throw new ExportError("Hub export connection is not configured.");
  const endpoint = new URL("/api/export?format=json", baseUrl);
  const response = await fetch(endpoint, { headers: { Accept: "application/json", "X-Hub-Service": token } });
  if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("json")) {
    throw new ExportError(`Remote export failed for ${endpoint.host}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new ExportError(`Remote export returned invalid data for ${endpoint.host}.`);
  }
}

export async function createFullSnapshot(env: HubEnv, now = new Date()) {
  const personalEntries = await Promise.all(PERSONAL_TABLES.map(async (table) => [table, await fetchAllTableRows(env, table)] as const));
  const [knowledge, finance] = await Promise.all([
    fetchRemoteExport(env, env.NAV_KNOWLEDGE_URL?.trim() || DEFAULT_KNOWLEDGE_URL),
    fetchRemoteExport(env, env.NAV_FINANCIAL_URL?.trim() || DEFAULT_FINANCIAL_URL),
  ]);
  return {
    schemaVersion: "personal-hub-snapshot.v1",
    exportedAt: now.toISOString(),
    readOnly: true,
    personal: Object.fromEntries(personalEntries),
    knowledge,
    finance,
  };
}

export function exportFailureMessage(error: unknown): string {
  if (error instanceof ExportError) console.error(error.message);
  else console.error("snapshot export failed");
  return "全体スナップショットを作成できませんでした。接続状態を確認して再試行してください。";
}
