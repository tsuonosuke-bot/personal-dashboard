/** Persist Want routes and compare source snapshots; routing decisions stay in wantRouting. */
import { type DashboardEnv, DashboardError } from "./dashboard.ts";
import {
  type SupabaseConnection,
  type WantRouteInput,
  type StoredWant,
  isPlainObject,
  type StoredRoute,
  normalizeRoute,
  type RouteRow,
} from "./wantRouteModel.ts";
import { fetchSupabase } from "@personal-dashboards/auth";
import { supabaseHeaders } from "./supabaseAuth.ts";

export function connection(env: DashboardEnv): SupabaseConnection {
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

export function restEndpoint(connectionInfo: SupabaseConnection, table: string): URL {
  return new URL(`/rest/v1/${table}`, connectionInfo.url);
}

export async function supabaseFetch(
  connectionInfo: SupabaseConnection,
  endpoint: URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetchSupabase(endpoint, {
      ...init,
      headers: supabaseHeaders(
        connectionInfo.key,
        (init.headers || {}) as Record<string, string>,
      ),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach Supabase.");
  }
}

export function responseError(response: Response, resource: string): DashboardError {
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${resource} returned ${response.status}.`);
}

export async function readWant(connectionInfo: SupabaseConnection, input: WantRouteInput): Promise<StoredWant> {
  const endpoint = restEndpoint(connectionInfo, "wants");
  endpoint.searchParams.set("select", "id,content,status");
  endpoint.searchParams.set("id", `eq.${input.wantId}`);
  endpoint.searchParams.set("content", `eq.${input.original.content}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "wants");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "wants returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("WANT_UPDATE_CONFLICT", "Want changed before routing.", 409);
  const row = rows[0];
  if (!isPlainObject(row) || Number(row.id) !== input.wantId || row.content !== input.original.content || typeof row.status !== "string") {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "wants returned invalid data.");
  }
  return { id: input.wantId, content: input.original.content, status: row.status };
}

export async function completeWant(
  connectionInfo: SupabaseConnection,
  input: WantRouteInput,
  current: StoredWant,
): Promise<void> {
  if (current.status === "completed") return;
  if (current.status !== "active") {
    throw new DashboardError("WANT_AUTO_CLOSE_FAILED", "Want is no longer active after routing.", 409);
  }

  const endpoint = restEndpoint(connectionInfo, "wants");
  endpoint.searchParams.set("select", "id,content,status");
  endpoint.searchParams.set("id", `eq.${input.wantId}`);
  endpoint.searchParams.set("content", `eq.${input.original.content}`);
  endpoint.searchParams.set("status", "eq.active");
  let response: Response;
  try {
    response = await supabaseFetch(connectionInfo, endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ status: "completed" }),
    });
  } catch {
    throw new DashboardError("WANT_AUTO_CLOSE_FAILED", "Could not complete Want after routing.");
  }
  if (!response.ok) {
    throw new DashboardError("WANT_AUTO_CLOSE_FAILED", `wants returned ${response.status} after routing.`, response.status >= 500 ? 502 : 409);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new DashboardError("WANT_AUTO_CLOSE_FAILED", "wants returned invalid data after routing.");
  }
  if (rows.length === 1 && isPlainObject(rows[0]) && Number(rows[0].id) === input.wantId && rows[0].status === "completed") return;
  if (rows.length > 1) {
    throw new DashboardError("WANT_AUTO_CLOSE_FAILED", "wants updated an unexpected number of rows after routing.");
  }

  try {
    const latest = await readWant(connectionInfo, input);
    if (latest.status === "completed") return;
  } catch {
    // Report the routing-specific failure below so the user knows the target may already exist.
  }
  throw new DashboardError("WANT_AUTO_CLOSE_FAILED", "Want changed before automatic completion.", 409);
}

export const routeSelect = "id,want_id,intent,destination,status,title,detail,cadence,target_id,target_url,error_code,destination_data,idempotency_key,created_at,updated_at";

export async function findRoute(connectionInfo: SupabaseConnection, idempotencyKey: string): Promise<StoredRoute | null> {
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("select", routeSelect);
  endpoint.searchParams.set("idempotency_key", `eq.${idempotencyKey}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  return rows.length > 0 ? normalizeRoute(rows[0] as RouteRow) : null;
}

export async function insertRoute(connectionInfo: SupabaseConnection, input: WantRouteInput): Promise<StoredRoute> {
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("select", routeSelect);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      want_id: input.wantId,
      intent: input.intent,
      destination: input.destination,
      status: "planned",
      title: input.title,
      detail: input.detail,
      cadence: input.cadence,
      destination_data: input.calendar ? { calendar: input.calendar } : {},
      idempotency_key: input.idempotencyKey,
    }),
  });
  if (response.status === 409) {
    const existing = await findRoute(connectionInfo, input.idempotencyKey);
    if (existing) return existing;
  }
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  }
  return normalizeRoute(rows[0] as RouteRow);
}

export async function updateRoute(
  connectionInfo: SupabaseConnection,
  route: StoredRoute,
  changes: Record<string, unknown>,
): Promise<StoredRoute> {
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("id", `eq.${route.id}`);
  endpoint.searchParams.set("status", `eq.${route.status}`);
  endpoint.searchParams.set("select", routeSelect);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("WANT_ROUTE_CONFLICT", "Route changed before update.", 409);
  return normalizeRoute(rows[0] as RouteRow);
}
