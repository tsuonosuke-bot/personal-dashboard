import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";

/** ホームで表示/非表示を選べるセクション。キーは public/index.html の data-home-section と同じ。 */
export const HOME_SECTIONS = ["apps", "today", "focus", "learning", "inbox", "expenses", "knowledge", "journal", "data"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

const MAX_REQUEST_CHARS = 2_000;

export function normalizeHidden(value: unknown): HomeSection[] {
  if (!Array.isArray(value)) return [];
  return HOME_SECTIONS.filter((key) => value.includes(key));
}

function connection(env: DashboardEnv) {
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

async function request(env: DashboardEnv, endpoint: (base: URL) => URL, init: RequestInit = {}) {
  const { url, key } = connection(env);
  try {
    return await fetchSupabase(endpoint(url), {
      ...init,
      headers: { Accept: "application/json", apikey: key, ...(init.headers || {}) },
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach hub_home_settings.");
  }
}

export async function loadHomeSettings(env: DashboardEnv): Promise<{ hidden: HomeSection[] }> {
  const response = await request(env, (base) => {
    const endpoint = new URL("/rest/v1/hub_home_settings", base);
    endpoint.searchParams.set("select", "hidden_sections");
    endpoint.searchParams.set("id", "eq.home");
    return endpoint;
  });
  if (!response.ok) throw new DashboardError("SUPABASE_REQUEST_FAILED", "hub_home_settings read failed.");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "hub_home_settings returned invalid data.");
  const row = rows[0] as { hidden_sections?: unknown } | undefined;
  return { hidden: normalizeHidden(row?.hidden_sections) };
}

export async function saveHomeSettings(env: DashboardEnv, hidden: HomeSection[]): Promise<{ hidden: HomeSection[] }> {
  const response = await request(
    env,
    (base) => {
      const endpoint = new URL("/rest/v1/hub_home_settings", base);
      endpoint.searchParams.set("on_conflict", "id");
      return endpoint;
    },
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: "home", hidden_sections: hidden, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw new DashboardError("SUPABASE_REQUEST_FAILED", "hub_home_settings save failed.");
  return { hidden };
}

export function validateHomeSettingsRequest(request: Request): { status: number; error: string } | null {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== origin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "home-settings-update") {
    return { status: 403, error: "操作用ヘッダーがありません。" };
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  return null;
}

export async function readHomeSettingsInput(
  request: Request,
): Promise<{ ok: true; value: HomeSection[] } | { ok: false; status: number; error: string }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "JSON形式で送信してください。" };
  }
  const hidden = (body as { hidden?: unknown } | null)?.hidden;
  if (!Array.isArray(hidden) || hidden.some((key) => !HOME_SECTIONS.includes(key as HomeSection))) {
    return { ok: false, status: 400, error: "表示設定の形式が正しくありません。" };
  }
  return { ok: true, value: normalizeHidden(hidden) };
}
