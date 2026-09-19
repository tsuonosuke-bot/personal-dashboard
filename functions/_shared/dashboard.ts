export interface DashboardEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  NAV_KNOWLEDGE_URL?: string;
  NAV_FINANCIAL_URL?: string;
  NAV_TASK_BOARD_URL?: string;
}

type TableName = "idea_inbox" | "wants";

interface TableDefinition {
  name: TableName;
  select: string;
  order: string;
}

interface InboxRow {
  id?: unknown;
  content?: unknown;
  status?: unknown;
  result?: unknown;
  created_at?: unknown;
}

interface WantRow {
  id?: unknown;
  content?: unknown;
  status?: unknown;
  type?: unknown;
  revisit_on?: unknown;
  revisit_count?: unknown;
  note?: unknown;
  created_at?: unknown;
}

const TABLES: Record<string, TableDefinition> = {
  inbox: { name: "idea_inbox", select: "id,content,status,result,created_at", order: "created_at.desc,id.desc" },
  wants: { name: "wants", select: "id,content,status,type,revisit_on,revisit_count,note,created_at", order: "created_at.desc,id.desc" },
};

const PAGE_SIZE = 1000;

export class DashboardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function connection(env: DashboardEnv): { url: URL; key: string } {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { url, key };
}

async function fetchTable(env: DashboardEnv, definition: TableDefinition): Promise<unknown[]> {
  const { url, key } = connection(env);
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${definition.name}`, url);
    endpoint.searchParams.set("select", definition.select);
    endpoint.searchParams.set("order", definition.order);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          apikey: key,
        },
      });
    } catch {
      throw new DashboardError("SUPABASE_UNAVAILABLE", `Could not reach ${definition.name}.`);
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED";
      throw new DashboardError(code, `${definition.name} returned ${response.status}.`);
    }
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${definition.name} returned invalid data.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function plainDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeNavigationUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return url.protocol === "https:" || local ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeDashboard(
  inboxRows: InboxRow[],
  wantRows: WantRow[],
  env: DashboardEnv = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  const inbox = inboxRows.map((row) => ({
    id: integer(row.id),
    content: text(row.content),
    status: text(row.status) || "unknown",
    result: text(row.result) || null,
    createdAt: isoDate(row.created_at),
  }));
  const wants = wantRows.map((row) => ({
    id: integer(row.id),
    content: text(row.content),
    status: text(row.status) || "unknown",
    type: text(row.type) || "want",
    revisitOn: plainDate(row.revisit_on),
    revisitCount: integer(row.revisit_count) ?? 0,
    note: text(row.note) || null,
    createdAt: isoDate(row.created_at),
  }));

  return {
    app: { appId: "personal-dashboard", version: "0.8.0", mode: "read-write" },
    source: { system: "supabase", state: "live", fetchedAt: new Date().toISOString() },
    navigation: [
      { id: "hub", label: "Hub", url: "/", current: false },
      { id: "compass", label: "Compass", url: null, current: true },
      { id: "knowledge", label: "Knowledge DB", url: "/go/knowledge", current: false },
      { id: "financial", label: "Financial", url: "/go/financial", current: false },
      { id: "task-board", label: "Task Board", url: safeNavigationUrl(env.NAV_TASK_BOARD_URL), current: false },
    ],
    summary: {
      inboxTotal: inbox.length,
      pendingInbox: inbox.filter((item) => item.status === "pending").length,
      wantsTotal: wants.length,
      activeWants: wants.filter((item) => item.status === "active").length,
      dueForReview: wants.filter((item) => item.status === "active" && item.revisitOn !== null && item.revisitOn <= today).length,
    },
    inbox,
    wants,
  };
}

export async function loadDashboard(env: DashboardEnv) {
  const [inbox, wants] = await Promise.all([
    fetchTable(env, TABLES.inbox) as Promise<InboxRow[]>,
    fetchTable(env, TABLES.wants) as Promise<WantRow[]>,
  ]);
  return normalizeDashboard(inbox, wants, env);
}

export function publicError(error: unknown) {
  const code = error instanceof DashboardError ? error.code : "DASHBOARD_LOAD_FAILED";
  const status = error instanceof DashboardError ? error.status : 502;
  const messages: Record<string, string> = {
    SUPABASE_NOT_CONFIGURED: "サーバーのSupabase接続設定が未完了です。",
    SUPABASE_CONFIG_INVALID: "サーバーのSupabase接続設定が正しくありません。",
    SUPABASE_ACCESS_DENIED: "Supabaseへの読取権限がありません。",
    SUPABASE_UNAVAILABLE: "Supabaseへ接続できませんでした。",
    SUPABASE_REQUEST_FAILED: "Supabaseからデータを取得できませんでした。",
    SUPABASE_RESPONSE_INVALID: "Supabaseから想定外の応答を受信しました。",
    INBOX_UPDATE_CONFLICT: "このInboxは別の画面で更新されています。再読み込みしてからやり直してください。",
    WANT_UPDATE_CONFLICT: "このWantは別の画面で更新されています。再読み込みしてからやり直してください。",
  };
  return { code, status, message: messages[code] || "ダッシュボードを読み込めませんでした。" };
}
