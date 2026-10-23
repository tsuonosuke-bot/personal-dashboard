import { safeEqual } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  listGoogleCalendarEvents,
  parseCalendarSchedule,
  type CalendarSchedule,
  type GoogleCalendarListedEvent,
} from "./googleCalendar.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";
import { projectTodoRpc } from "./projectActionTodos.ts";

export const CALENDAR_SYNC_WINDOW_DAYS = 90;

export interface CalendarSyncEnv extends DashboardEnv {
  CALENDAR_SYNC_SECRET?: string;
}

/** pg_cronからのBearerだけを通す。短い秘密は未設定と同じに扱う。 */
export function hasCalendarSyncCredential(request: Request, env: CalendarSyncEnv): boolean {
  const expected = env.CALENDAR_SYNC_SECRET?.trim() || "";
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  return expected.length >= 32 && Boolean(match) && safeEqual(match![1], expected);
}

export interface MirroredAction {
  id: number;
  googleEventId: string;
  status: string;
  schedule: CalendarSchedule | null;
  title: string | null;
  url: string | null;
  etag: string | null;
  calendarState: string;
}

export interface CalendarSyncPlan {
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ id: number; changes: Record<string, unknown> }>;
  /** 未着手のままCalendarから消えた行。ユーザーの操作が何も残っていないので削除する。 */
  deletes: number[];
}

export interface CalendarSyncResult {
  listed: number;
  inserted: number;
  updated: number;
  deleted: number;
  complete: boolean;
}

/**
 * Calendarの一覧と既存のミラー行を突き合わせて、必要な書き込みだけを決める。
 * Dashboardから作った予定(routedEventIds)は既存のToDo行が管理するので対象外。
 * 一覧に現れない行は、窓の外へ動いただけの可能性があるので触らない。
 */
export function planCalendarSync(
  events: GoogleCalendarListedEvent[],
  existing: MirroredAction[],
  routedEventIds: Set<string>,
  syncedAt: string,
): CalendarSyncPlan {
  const byEvent = new Map(existing.map((row) => [row.googleEventId, row]));
  const plan: CalendarSyncPlan = { inserts: [], updates: [], deletes: [] };
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId) || routedEventIds.has(event.eventId)) continue;
    seen.add(event.eventId);
    const row = byEvent.get(event.eventId);
    if (event.status === "cancelled") {
      if (!row) continue;
      if (row.status === "pending") plan.deletes.push(row.id);
      else if (row.calendarState !== "cancelled") plan.updates.push({ id: row.id, changes: { calendar_state: "cancelled", last_calendar_sync_at: syncedAt } });
      continue;
    }
    if (!event.schedule) continue;
    const title = event.title || "(タイトルなし)";
    if (!row) {
      plan.inserts.push({
        google_event_id: event.eventId,
        current_schedule: event.schedule,
        calendar_title: title,
        calendar_url: event.targetUrl,
        calendar_etag: event.etag,
        calendar_state: "confirmed",
        last_calendar_sync_at: syncedAt,
      });
      continue;
    }
    const unchanged = row.calendarState === "confirmed"
      && row.title === title
      && row.url === event.targetUrl
      && row.etag === event.etag
      && JSON.stringify(row.schedule) === JSON.stringify(event.schedule);
    if (unchanged) continue;
    plan.updates.push({
      id: row.id,
      changes: {
        current_schedule: event.schedule,
        calendar_title: title,
        calendar_url: event.targetUrl,
        calendar_etag: event.etag,
        calendar_state: "confirmed",
        last_calendar_sync_at: syncedAt,
        updated_at: syncedAt,
      },
    });
  }
  return plan;
}

function tokyoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 今日(東京)の0時から90日先の0時まで。 */
export function calendarSyncWindow(now: Date): { timeMin: string; timeMax: string } {
  const start = new Date(`${tokyoDate(now)}T00:00:00+09:00`);
  return {
    timeMin: start.toISOString(),
    timeMax: new Date(start.getTime() + CALENDAR_SYNC_WINDOW_DAYS * 86_400_000).toISOString(),
  };
}

function restEndpoint(env: DashboardEnv, table: string): URL {
  const rawUrl = env.SUPABASE_URL?.trim();
  if (!rawUrl || !env.SUPABASE_SECRET_KEY?.trim()) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return new URL(`/rest/v1/${table}`, url);
}

async function rest(env: DashboardEnv, endpoint: URL, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(endpoint, { ...init, headers: supabaseHeaders(env.SUPABASE_SECRET_KEY!.trim(), (init.headers || {}) as Record<string, string>) });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach the calendar sync tables.");
  }
  if (!response.ok) {
    throw new DashboardError(response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED", `${endpoint.pathname} returned ${response.status}.`);
  }
  return response;
}

async function readRows(env: DashboardEnv, table: string, select: string, filters: Record<string, string>): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const endpoint = restEndpoint(env, table);
    endpoint.searchParams.set("select", select);
    endpoint.searchParams.set("order", "id.asc");
    endpoint.searchParams.set("limit", "1000");
    endpoint.searchParams.set("offset", String(offset));
    for (const [key, value] of Object.entries(filters)) endpoint.searchParams.set(key, value);
    const page: unknown = await (await rest(env, endpoint)).json();
    if (!Array.isArray(page)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
    rows.push(...page.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null));
    if (page.length < 1000) return rows;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function syncCalendarToTodos(env: DashboardEnv, now = new Date()): Promise<CalendarSyncResult> {
  const { timeMin, timeMax } = calendarSyncWindow(now);
  const [listing, mirrored, routes] = await Promise.all([
    listGoogleCalendarEvents(env, timeMin, timeMax),
    readRows(env, "scheduled_actions", "id,google_event_id,status,current_schedule,calendar_title,calendar_url,calendar_etag,calendar_state", { google_event_id: "not.is.null" }),
    readRows(env, "want_routes", "id,target_id", { destination: "eq.calendar", status: "eq.created", target_id: "not.is.null" }),
  ]);
  const existing: MirroredAction[] = mirrored.flatMap((row) => {
    const googleEventId = text(row.google_event_id);
    const id = Number(row.id);
    if (!googleEventId || !Number.isSafeInteger(id)) return [];
    return [{
      id,
      googleEventId,
      status: text(row.status) || "pending",
      schedule: parseCalendarSchedule(row.current_schedule),
      title: text(row.calendar_title),
      url: text(row.calendar_url),
      etag: text(row.calendar_etag),
      calendarState: text(row.calendar_state) || "confirmed",
    }];
  });
  const routed = new Set(routes.flatMap((row) => text(row.target_id) ?? []));
  const plan = planCalendarSync(listing.events, existing, routed, now.toISOString());

  if (plan.inserts.length) {
    const endpoint = restEndpoint(env, "scheduled_actions");
    endpoint.searchParams.set("on_conflict", "google_event_id");
    await rest(env, endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(plan.inserts),
    });
  }
  for (const update of plan.updates) {
    const endpoint = restEndpoint(env, "scheduled_actions");
    endpoint.searchParams.set("id", `eq.${update.id}`);
    await rest(env, endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(update.changes),
    });
  }
  let deleted = 0;
  if (plan.deletes.length) {
    const count = await projectTodoRpc(env, "delete_unlinked_scheduled_actions", { p_ids: plan.deletes, p_synced_at: now.toISOString() });
    if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > plan.deletes.length) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid cancellation result.");
    deleted = Number(count);
  }
  return {
    listed: listing.events.length,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    deleted,
    complete: listing.complete,
  };
}
