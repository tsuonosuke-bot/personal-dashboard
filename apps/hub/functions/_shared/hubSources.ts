/** Hub data acquisition, pagination and per-source failures. Mapping remains in hubModel. */
import { type HubEnv, HubError, type QueryDefinition, type DailyJournalRow, type JournalMoment, journalTargets, normalizeJournalMoment, type JournalTrend, journalTrendRange, normalizeJournalTrend } from "./hubModel.ts";
import { fetchSupabase } from "@personal-dashboards/auth";
import { type FocusRow, normalizeFocusRows } from "./focus.ts";

const PAGE_SIZE = 1_000;

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

export async function fetchRows(env: HubEnv, query: QueryDefinition): Promise<unknown[]> {
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
      response = await fetchSupabase(endpoint, { headers: { Accept: "application/json", apikey: key } });
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

export async function fetchFocusRows(env: HubEnv): Promise<FocusRow[]> {
  const rows = await fetchRows(env, {
    table: "focus_items",
    select: "id,source_route_id,source_want_id,content,note,status,sort_order,created_at,updated_at",
    order: "status.asc,sort_order.asc.nullslast,created_at.asc,id.asc",
  }) as FocusRow[];
  try {
    normalizeFocusRows(rows);
  } catch {
    throw new HubError("SUPABASE_RESPONSE_INVALID", "focus_items returned invalid data.");
  }
  return rows;
}

export async function fetchDashboardRows(env: HubEnv, baseUrl: string, path: string): Promise<unknown[]> {
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

export async function fetchDashboardJson(env: HubEnv, baseUrl: string, path: string): Promise<unknown> {
  const token = env.HUB_SERVICE_TOKEN?.trim();
  if (!token || token.length < 32) throw new HubError("HUB_SERVICE_NOT_CONFIGURED", "Hub service token is not configured.", 503);
  const endpoint = new URL(path, baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Accept: "application/json", "X-Hub-Service": token } });
  } catch {
    throw new HubError("HUB_SERVICE_UNAVAILABLE", `Could not reach ${endpoint.host}.`);
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "HUB_SERVICE_ACCESS_DENIED"
      : "HUB_SERVICE_REQUEST_FAILED";
    throw new HubError(code, `${endpoint.host} returned ${response.status}.`);
  }
  return response.json();
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
    response = await fetchSupabase(endpoint, { headers: { Accept: "application/json", apikey: key } });
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

export async function loadJournalMoments(env: HubEnv, now: Date): Promise<JournalMoment[]> {
  const targets = journalTargets(now);
  const rows = await Promise.all(targets.map((target) => fetchLatestJournal(env, target.targetDate)));
  return targets.map((target, index) => normalizeJournalMoment(target, rows[index]));
}

export async function loadJournalTrend(env: HubEnv, now: Date): Promise<JournalTrend> {
  const { startDate, endDate } = journalTrendRange(now);
  const rows = await fetchRows(env, {
    table: "daily_journal",
    select: "entry_date,mood",
    order: "entry_date.asc",
    filters: { and: `(entry_date.gte.${startDate},entry_date.lte.${endDate})` },
  }) as DailyJournalRow[];
  return normalizeJournalTrend(rows, now);
}
