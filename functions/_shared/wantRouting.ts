import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  assertGoogleCalendarConnected,
  createGoogleCalendarEvent,
  parseCalendarSchedule,
  type CalendarSchedule,
} from "./googleCalendar.ts";
import { WANT_ROUTE_ADAPTERS } from "./wantRouteAdapters.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

const MAX_REQUEST_CHARS = 8_000;
const MAX_TITLE_CHARS = 240;
const MAX_DETAIL_CHARS = 2_000;

export const ROUTE_DESTINATIONS = [
  "calendar",
  "github",
  "writing",
  "habit",
  "knowledge",
  "focus",
  "journal",
  "archive",
] as const;

export const ROUTE_INTENTS = ["act", "continue", "explore", "keep", "discard"] as const;
export const HABIT_CADENCES = ["daily", "weekdays", "weekly", "flexible"] as const;

type RouteDestination = typeof ROUTE_DESTINATIONS[number];
type RouteIntent = typeof ROUTE_INTENTS[number];
type HabitCadence = typeof HABIT_CADENCES[number];

const destinationSet = new Set<string>(ROUTE_DESTINATIONS);
const intentSet = new Set<string>(ROUTE_INTENTS);
const cadenceSet = new Set<string>(HABIT_CADENCES);
const allowedDestinationsByIntent: Record<RouteIntent, ReadonlySet<RouteDestination>> = {
  act: new Set(["calendar", "github"]),
  continue: new Set(["habit"]),
  explore: new Set(["calendar", "knowledge", "writing"]),
  keep: new Set(["focus", "journal", "archive"]),
  discard: new Set(["archive"]),
};

interface WantSnapshot {
  content: string;
  status: "active";
}

export interface WantRouteInput {
  wantId: number;
  intent: RouteIntent;
  destination: RouteDestination;
  title: string;
  detail: string | null;
  cadence: HabitCadence | null;
  calendar: CalendarSchedule | null;
  idempotencyKey: string;
  original: WantSnapshot;
}

type ValidationResult =
  | { ok: true; value: WantRouteInput }
  | { ok: false; status: number; error: string };

interface RouteRow {
  id?: unknown;
  want_id?: unknown;
  intent?: unknown;
  destination?: unknown;
  status?: unknown;
  title?: unknown;
  detail?: unknown;
  cadence?: unknown;
  target_id?: unknown;
  target_url?: unknown;
  error_code?: unknown;
  destination_data?: unknown;
  idempotency_key?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface StoredRoute {
  id: number;
  wantId: number;
  intent: RouteIntent;
  destination: RouteDestination;
  status: "planned" | "created" | "failed" | "cancelled";
  title: string;
  detail: string | null;
  cadence: HabitCadence | null;
  targetId: string | null;
  targetUrl: string | null;
  errorCode: string | null;
  calendar: CalendarSchedule | null;
  idempotencyKey: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SupabaseConnection {
  url: URL;
  key: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function connection(env: DashboardEnv): SupabaseConnection {
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

function restEndpoint(connectionInfo: SupabaseConnection, table: string): URL {
  return new URL(`/rest/v1/${table}`, connectionInfo.url);
}

async function supabaseFetch(
  connectionInfo: SupabaseConnection,
  endpoint: URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(endpoint, {
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

function responseError(response: Response, resource: string): DashboardError {
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${resource} returned ${response.status}.`);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeRoute(row: RouteRow): StoredRoute {
  const id = Number(row.id);
  const wantId = Number(row.want_id);
  const intent = typeof row.intent === "string" && intentSet.has(row.intent) ? row.intent as RouteIntent : null;
  const destination = typeof row.destination === "string" && destinationSet.has(row.destination)
    ? row.destination as RouteDestination
    : null;
  const status = typeof row.status === "string" && ["planned", "created", "failed", "cancelled"].includes(row.status)
    ? row.status as StoredRoute["status"]
    : null;
  const cadence = typeof row.cadence === "string" && cadenceSet.has(row.cadence)
    ? row.cadence as HabitCadence
    : null;
  const destinationData = isPlainObject(row.destination_data) ? row.destination_data : {};
  const calendar = parseCalendarSchedule(destinationData.calendar);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(wantId) || wantId <= 0 || !intent || !destination || !status) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  }
  if (typeof row.title !== "string" || typeof row.idempotency_key !== "string") {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  }
  return {
    id,
    wantId,
    intent,
    destination,
    status,
    title: row.title,
    detail: stringOrNull(row.detail),
    cadence,
    targetId: stringOrNull(row.target_id),
    targetUrl: stringOrNull(row.target_url),
    errorCode: stringOrNull(row.error_code),
    calendar,
    idempotencyKey: row.idempotency_key,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export function validateWantRouteRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "want-route-create") {
    return { status: 403, error: "振り分け用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readWantRouteInput(request: Request): Promise<ValidationResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  const keys = ["wantId", "intent", "destination", "title", "detail", "cadence", "calendar", "idempotencyKey", "original"];
  const requiredKeys = ["wantId", "intent", "destination", "title", "detail", "cadence", "idempotencyKey", "original"];
  if (!isPlainObject(value) || !Object.keys(value).every((key) => keys.includes(key)) || !requiredKeys.every((key) => key in value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.wantId) || Number(value.wantId) <= 0) {
    return { ok: false, status: 400, error: "Want IDが正しくありません。" };
  }
  if (typeof value.intent !== "string" || !intentSet.has(value.intent)) {
    return { ok: false, status: 400, error: "整理方法が正しくありません。" };
  }
  if (typeof value.destination !== "string" || !destinationSet.has(value.destination)) {
    return { ok: false, status: 400, error: "振り分け先が正しくありません。" };
  }
  const intent = value.intent as RouteIntent;
  const destination = value.destination as RouteDestination;
  if (!allowedDestinationsByIntent[intent].has(destination)) {
    return { ok: false, status: 400, error: "整理方法と振り分け先の組み合わせが正しくありません。" };
  }
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return { ok: false, status: 400, error: "タイトルを入力してください。" };
  }
  const title = value.title.trim();
  if (title.length > MAX_TITLE_CHARS) {
    return { ok: false, status: 400, error: `タイトルは${MAX_TITLE_CHARS}文字以内で入力してください。` };
  }
  if (value.detail !== null && typeof value.detail !== "string") {
    return { ok: false, status: 400, error: "補足内容が正しくありません。" };
  }
  const detail = typeof value.detail === "string" && value.detail.trim().length > 0 ? value.detail.trim() : null;
  if ((detail?.length || 0) > MAX_DETAIL_CHARS) {
    return { ok: false, status: 400, error: `補足内容は${MAX_DETAIL_CHARS}文字以内で入力してください。` };
  }
  if (value.cadence !== null && (typeof value.cadence !== "string" || !cadenceSet.has(value.cadence))) {
    return { ok: false, status: 400, error: "習慣の頻度が正しくありません。" };
  }
  const cadence = value.cadence as HabitCadence | null;
  if (destination === "habit" && !cadence) return { ok: false, status: 400, error: "習慣の頻度を選択してください。" };
  if (destination !== "habit" && cadence !== null) {
    return { ok: false, status: 400, error: "この振り分け先には習慣の頻度を設定できません。" };
  }
  const calendar = parseCalendarSchedule(value.calendar);
  if (destination === "calendar" && !calendar) {
    return { ok: false, status: 400, error: "Google Calendarへ登録する日付と時間を確認してください。" };
  }
  if (destination !== "calendar" && value.calendar !== undefined && value.calendar !== null) {
    return { ok: false, status: 400, error: "この振り分け先にはCalendar予定を設定できません。" };
  }
  if (typeof value.idempotencyKey !== "string" || !isUuid(value.idempotencyKey)) {
    return { ok: false, status: 400, error: "処理IDが正しくありません。" };
  }
  if (!isPlainObject(value.original) || !hasOnlyKeys(value.original, ["content", "status"]) ||
      typeof value.original.content !== "string" || value.original.content.length > 2_000 || value.original.status !== "active") {
    return { ok: false, status: 400, error: "整理前のWant情報が正しくありません。" };
  }

  return {
    ok: true,
    value: {
      wantId: Number(value.wantId),
      intent,
      destination,
      title,
      detail,
      cadence,
      calendar,
      idempotencyKey: value.idempotencyKey,
      original: { content: value.original.content, status: "active" },
    },
  };
}

async function verifyWant(connectionInfo: SupabaseConnection, input: WantRouteInput): Promise<void> {
  const endpoint = restEndpoint(connectionInfo, "wants");
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("id", `eq.${input.wantId}`);
  endpoint.searchParams.set("content", `eq.${input.original.content}`);
  endpoint.searchParams.set("status", "eq.active");
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "wants");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "wants returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("WANT_UPDATE_CONFLICT", "Want changed before routing.", 409);
}

const routeSelect = "id,want_id,intent,destination,status,title,detail,cadence,target_id,target_url,error_code,destination_data,idempotency_key,created_at,updated_at";

async function findRoute(connectionInfo: SupabaseConnection, idempotencyKey: string): Promise<StoredRoute | null> {
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

async function insertRoute(connectionInfo: SupabaseConnection, input: WantRouteInput): Promise<StoredRoute> {
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

async function updateRoute(
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

async function createInternalTarget(
  connectionInfo: SupabaseConnection,
  route: StoredRoute,
  input: WantRouteInput,
): Promise<{ targetId: string; targetUrl: string | null }> {
  const adapter = WANT_ROUTE_ADAPTERS[input.destination];
  if (!adapter) throw new DashboardError("WANT_ROUTE_INVALID", "Destination adapter is missing.", 400);
  if (adapter.mode === "archive") return { targetId: `want:${input.wantId}`, targetUrl: null };
  if (adapter.mode !== "internal") {
    throw new DashboardError("WANT_ROUTE_INVALID", "Destination does not have an internal adapter.", 400);
  }
  const endpoint = restEndpoint(connectionInfo, adapter.table);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("on_conflict", "source_route_id");
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(adapter.payload({
      routeId: route.id,
      wantId: input.wantId,
      title: input.title,
      detail: input.detail,
      cadence: input.cadence,
    })),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw responseError(response, adapter.table);
    if (adapter.table === "focus_items") {
      const detail = await response.text().catch(() => "");
      if (detail.includes("FOCUS_ACTIVE_LIMIT")) {
        throw new DashboardError("FOCUS_LIMIT_REACHED", "The active Focus board is full.", 409);
      }
    }
    throw new DashboardError("WANT_ROUTE_FAILED", `${adapter.table} returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !isPlainObject(rows[0]) || !Number.isSafeInteger(Number(rows[0].id))) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${adapter.table} returned invalid data.`);
  }
  const targetId = String(rows[0].id);
  return {
    targetId,
    targetUrl: adapter.table === "writing_topics" ? `/writing/?id=${encodeURIComponent(targetId)}` : null,
  };
}

export async function routeWant(env: DashboardEnv, input: WantRouteInput): Promise<StoredRoute> {
  const connectionInfo = connection(env);
  await verifyWant(connectionInfo, input);

  const adapter = WANT_ROUTE_ADAPTERS[input.destination];
  if (!adapter) throw new DashboardError("WANT_ROUTE_INVALID", "Destination adapter is missing.", 400);

  const existing = await findRoute(connectionInfo, input.idempotencyKey);
  let route: StoredRoute;
  if (existing) {
    if (existing.wantId !== input.wantId || existing.intent !== input.intent || existing.destination !== input.destination ||
        existing.title !== input.title || existing.detail !== input.detail || existing.cadence !== input.cadence ||
        JSON.stringify(existing.calendar) !== JSON.stringify(input.calendar)) {
      throw new DashboardError("WANT_ROUTE_CONFLICT", "Idempotency key belongs to another route.", 409);
    }
    route = existing;
  } else {
    if (adapter.mode === "external" && adapter.provider === "google_calendar") {
      await assertGoogleCalendarConnected(env);
    }
    route = await insertRoute(connectionInfo, input);
  }

  if (adapter.mode === "planned") return route;
  if (route.status === "created") return route;
  if (route.status === "cancelled") throw new DashboardError("WANT_ROUTE_CONFLICT", "Cancelled route cannot be retried.", 409);
  if (adapter.mode === "external" && adapter.provider === "google_calendar") {
    await assertGoogleCalendarConnected(env);
  }
  if (route.status === "failed") {
    route = await updateRoute(connectionInfo, route, { status: "planned", error_code: null });
  }

  try {
    const target = adapter.mode === "external" && adapter.provider === "google_calendar"
      ? await createGoogleCalendarEvent(env, {
          wantId: input.wantId,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          detail: input.detail,
          schedule: input.calendar!,
        })
      : await createInternalTarget(connectionInfo, route, input);
    return await updateRoute(connectionInfo, route, {
      status: "created",
      target_id: target.targetId,
      target_url: target.targetUrl,
      error_code: null,
    });
  } catch (error) {
    const failure = error instanceof DashboardError ? error : new DashboardError("WANT_ROUTE_FAILED", "Route failed.");
    try {
      await updateRoute(connectionInfo, route, { status: "failed", error_code: failure.code });
    } catch {
      // The source Want remains active even if recording the failure also fails.
    }
    throw failure;
  }
}
