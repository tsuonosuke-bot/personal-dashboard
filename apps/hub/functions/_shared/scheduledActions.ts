import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  createReplacementGoogleCalendarEvent,
  parseCalendarSchedule,
  readGoogleCalendarEvents,
  rescheduleGoogleCalendarEvent,
  type CalendarSchedule,
  type GoogleCalendarEventSnapshot,
} from "./googleCalendar.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

type ScheduledActionStatus = "pending" | "completed" | "skipped";
type ScheduledActionCommand = "complete" | "skip" | "reopen" | "reschedule" | "recreate";

interface ScheduledActionRow {
  id?: unknown;
  source_route_id?: unknown;
  status?: unknown;
  current_schedule?: unknown;
  completed_at?: unknown;
  note?: unknown;
  reschedule_count?: unknown;
  last_calendar_sync_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface CalendarRouteRow {
  id?: unknown;
  want_id?: unknown;
  title?: unknown;
  detail?: unknown;
  target_id?: unknown;
  target_url?: unknown;
}

interface WantSourceRow {
  id?: unknown;
  content?: unknown;
  source_inbox_id?: unknown;
}

interface StoredAction {
  id: number;
  sourceRouteId: number;
  status: ScheduledActionStatus;
  schedule: CalendarSchedule;
  completedAt: string | null;
  note: string | null;
  rescheduleCount: number;
  lastCalendarSyncAt: string | null;
  createdAt: string | null;
  updatedAt: string;
}

export interface ScheduledActionInput {
  id: number;
  command: ScheduledActionCommand;
  note: string | null;
  schedule: CalendarSchedule | null;
  original: {
    status: ScheduledActionStatus;
    updatedAt: string;
    calendarEtag: string | null;
    schedule: CalendarSchedule | null;
  };
}

type ValidationResult =
  | { ok: true; value: ScheduledActionInput }
  | { ok: false; status: number; error: string };

const MAX_REQUEST_CHARS = 6_000;
const statusSet = new Set<ScheduledActionStatus>(["pending", "completed", "skipped"]);
const commandSet = new Set<ScheduledActionCommand>(["complete", "skip", "reopen", "reschedule", "recreate"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value));
}

function isoOrNull(value: unknown): string | null {
  return validTimestamp(value) ? new Date(value).toISOString() : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function scheduleEndsInFuture(schedule: CalendarSchedule): boolean {
  const end = schedule.allDay
    ? new Date(`${schedule.date}T23:59:59+09:00`)
    : new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() > Date.now();
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

function restEndpoint(env: DashboardEnv, table: string): URL {
  return new URL(`/rest/v1/${table}`, connection(env).url);
}

async function supabaseFetch(env: DashboardEnv, endpoint: URL, init: RequestInit = {}): Promise<Response> {
  const { key } = connection(env);
  try {
    return await fetch(endpoint, {
      ...init,
      headers: supabaseHeaders(key, (init.headers || {}) as Record<string, string>),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach scheduled actions.");
  }
}

function responseError(response: Response, table: string): DashboardError {
  const code = response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${table} returned ${response.status}.`);
}

async function fetchRows(env: DashboardEnv, table: string, select: string, order?: string): Promise<unknown[]> {
  const endpoint = restEndpoint(env, table);
  endpoint.searchParams.set("select", select);
  if (order) endpoint.searchParams.set("order", order);
  endpoint.searchParams.set("limit", "1000");
  const response = await supabaseFetch(env, endpoint);
  if (!response.ok) throw responseError(response, table);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
  return rows;
}

function normalizeAction(row: ScheduledActionRow): StoredAction {
  const id = integer(row.id);
  const sourceRouteId = integer(row.source_route_id);
  const status = typeof row.status === "string" && statusSet.has(row.status as ScheduledActionStatus)
    ? row.status as ScheduledActionStatus
    : null;
  const schedule = parseCalendarSchedule(row.current_schedule);
  if (!id || !sourceRouteId || !status || !schedule || !validTimestamp(row.updated_at)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "scheduled_actions returned invalid data.");
  }
  return {
    id,
    sourceRouteId,
    status,
    schedule,
    completedAt: isoOrNull(row.completed_at),
    note: textOrNull(row.note),
    rescheduleCount: Math.max(0, Number.isSafeInteger(Number(row.reschedule_count)) ? Number(row.reschedule_count) : 0),
    lastCalendarSyncAt: isoOrNull(row.last_calendar_sync_at),
    createdAt: isoOrNull(row.created_at),
    // Preserve PostgreSQL microseconds for optimistic concurrency.
    updatedAt: row.updated_at,
  };
}

function safeGoogleUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function listScheduledActions(env: DashboardEnv) {
  const [actionRows, routeRows, wantRows] = await Promise.all([
    fetchRows(env, "scheduled_actions", "id,source_route_id,status,current_schedule,completed_at,note,reschedule_count,last_calendar_sync_at,created_at,updated_at", "updated_at.desc,id.desc"),
    fetchRows(env, "want_routes", "id,want_id,title,detail,target_id,target_url", "created_at.desc,id.desc"),
    fetchRows(env, "wants", "id,content,source_inbox_id", "created_at.desc,id.desc"),
  ]);
  const actions = actionRows.map((row) => normalizeAction(row as ScheduledActionRow));
  const routes = new Map<number, CalendarRouteRow>();
  routeRows.forEach((row) => {
    if (isPlainObject(row) && integer(row.id)) routes.set(integer(row.id)!, row as CalendarRouteRow);
  });
  const wants = new Map<number, WantSourceRow>();
  wantRows.forEach((row) => {
    if (isPlainObject(row) && integer(row.id)) wants.set(integer(row.id)!, row as WantSourceRow);
  });

  const targetIds = actions.map((action) => textOrNull(routes.get(action.sourceRouteId)?.target_id)).filter((id): id is string => Boolean(id));
  let calendarEvents = new Map<string, GoogleCalendarEventSnapshot>();
  let calendarSync: "live" | "unavailable" = "live";
  try {
    calendarEvents = await readGoogleCalendarEvents(env, targetIds);
  } catch {
    calendarSync = "unavailable";
  }

  const items = actions.map((action) => {
    const route = routes.get(action.sourceRouteId);
    if (!route || !integer(route.want_id) || !textOrNull(route.target_id)) {
      throw new DashboardError("SUPABASE_RESPONSE_INVALID", "scheduled action route is missing.");
    }
    const wantId = integer(route.want_id)!;
    const want = wants.get(wantId);
    const targetId = textOrNull(route.target_id)!;
    const event = calendarEvents.get(targetId);
    return {
      id: action.id,
      status: action.status,
      title: event?.title || textOrNull(route.title) || textOrNull(want?.content) || "内容なし",
      detail: textOrNull(route.detail),
      sourceWantId: wantId,
      sourceInboxId: integer(want?.source_inbox_id),
      schedule: event?.schedule || action.schedule,
      calendarState: event?.status || (calendarSync === "live" ? "missing" : "unavailable"),
      calendarUrl: event?.targetUrl || safeGoogleUrl(route.target_url),
      calendarEtag: event?.etag || null,
      completedAt: action.completedAt,
      note: action.note,
      rescheduleCount: action.rescheduleCount,
      lastCalendarSyncAt: calendarSync === "live" ? new Date().toISOString() : action.lastCalendarSyncAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    };
  });

  return {
    source: { system: "google-calendar", state: calendarSync, fetchedAt: new Date().toISOString() },
    summary: {
      pending: items.filter((item) => item.status === "pending").length,
      completed: items.filter((item) => item.status === "completed").length,
      skipped: items.filter((item) => item.status === "skipped").length,
    },
    items,
  };
}

export function validateScheduledActionRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "scheduled-todo-update") {
    return { status: 403, error: "ToDo更新用ヘッダーがありません。" };
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) return { status: 413, error: "リクエストが大きすぎます。" };
  return null;
}

export async function readScheduledActionInput(request: Request): Promise<ValidationResult> {
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
  if (!isPlainObject(value) || !exactKeys(value, ["id", "command", "note", "schedule", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const id = integer(value.id);
  const command = typeof value.command === "string" && commandSet.has(value.command as ScheduledActionCommand)
    ? value.command as ScheduledActionCommand
    : null;
  if (!id || !command) return { ok: false, status: 400, error: "ToDoの操作内容が正しくありません。" };
  if (value.note !== null && typeof value.note !== "string") return { ok: false, status: 400, error: "実施メモが正しくありません。" };
  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim() : null;
  if ((note?.length || 0) > 2000) return { ok: false, status: 400, error: "実施メモは2000文字以内で入力してください。" };
  const schedule = value.schedule === null ? null : parseCalendarSchedule(value.schedule);
  if ((command === "reschedule" || command === "recreate") && !schedule) return { ok: false, status: 400, error: "新しい日付と時間を確認してください。" };
  if ((command === "reschedule" || command === "recreate") && schedule && !scheduleEndsInFuture(schedule)) {
    return { ok: false, status: 400, error: "実施予定は現在より後の日時を指定してください。" };
  }
  if (command !== "reschedule" && command !== "recreate" && value.schedule !== null) return { ok: false, status: 400, error: "この操作では予定日時を変更できません。" };
  if (!isPlainObject(value.original) || !exactKeys(value.original, ["status", "updatedAt", "calendarEtag", "schedule"])) {
    return { ok: false, status: 400, error: "変更前のToDo情報が正しくありません。" };
  }
  const originalStatus = typeof value.original.status === "string" && statusSet.has(value.original.status as ScheduledActionStatus)
    ? value.original.status as ScheduledActionStatus
    : null;
  const originalSchedule = value.original.schedule === null ? null : parseCalendarSchedule(value.original.schedule);
  const calendarEtag = typeof value.original.calendarEtag === "string" && value.original.calendarEtag.length <= 500
    ? value.original.calendarEtag
    : null;
  if (!originalStatus || !validTimestamp(value.original.updatedAt) || (value.original.schedule !== null && !originalSchedule)) {
    return { ok: false, status: 400, error: "変更前のToDo情報が正しくありません。" };
  }
  if (command === "reschedule" && (originalStatus !== "pending" || !calendarEtag || !originalSchedule)) {
    return { ok: false, status: 409, error: "Google Calendarの最新状態を再読み込みしてから日程を変更してください。" };
  }
  if (command === "recreate" && (originalStatus !== "pending" || !originalSchedule)) {
    return { ok: false, status: 409, error: "Google Calendarの最新状態を再読み込みしてから予定を再作成してください。" };
  }
  if ((command === "complete" || command === "skip") && originalStatus !== "pending") {
    return { ok: false, status: 409, error: "このToDoはすでに処理済みです。" };
  }
  if (command === "reopen" && originalStatus === "pending") {
    return { ok: false, status: 409, error: "このToDoはすでに未実施です。" };
  }
  return {
    ok: true,
    value: {
      id,
      command,
      note,
      schedule,
      original: {
        status: originalStatus,
        updatedAt: value.original.updatedAt,
        calendarEtag,
        schedule: originalSchedule,
      },
    },
  };
}

async function readActionForUpdate(env: DashboardEnv, input: ScheduledActionInput): Promise<StoredAction> {
  const endpoint = restEndpoint(env, "scheduled_actions");
  endpoint.searchParams.set("select", "id,source_route_id,status,current_schedule,completed_at,note,reschedule_count,last_calendar_sync_at,created_at,updated_at");
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("status", `eq.${input.original.status}`);
  endpoint.searchParams.set("updated_at", `eq.${input.original.updatedAt}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(env, endpoint);
  if (!response.ok) throw responseError(response, "scheduled_actions");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "scheduled_actions returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("SCHEDULED_ACTION_UPDATE_CONFLICT", "Scheduled action changed before update.", 409);
  return normalizeAction(rows[0] as ScheduledActionRow);
}

interface RouteTarget {
  id: number;
  wantId: number;
  targetId: string;
  title: string;
  detail: string | null;
}

async function readRouteTarget(env: DashboardEnv, sourceRouteId: number): Promise<RouteTarget> {
  const endpoint = restEndpoint(env, "want_routes");
  endpoint.searchParams.set("select", "id,want_id,destination,status,target_id,title,detail");
  endpoint.searchParams.set("id", `eq.${sourceRouteId}`);
  endpoint.searchParams.set("destination", "eq.calendar");
  endpoint.searchParams.set("status", "eq.created");
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(env, endpoint);
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  const row = rows[0];
  if (rows.length !== 1 || !isPlainObject(row) || !integer(row.id) || !integer(row.want_id) || !textOrNull(row.target_id) || !textOrNull(row.title)) {
    throw new DashboardError("SCHEDULED_ACTION_CALENDAR_MISSING", "Calendar route is missing.", 409);
  }
  return {
    id: integer(row.id)!,
    wantId: integer(row.want_id)!,
    targetId: textOrNull(row.target_id)!,
    title: textOrNull(row.title)!,
    detail: textOrNull(row.detail),
  };
}

async function replacementKey(action: StoredAction, schedule: CalendarSchedule): Promise<string> {
  const input = new TextEncoder().encode(`${action.id}:${action.updatedAt}:${JSON.stringify(schedule)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function replaceRouteTarget(
  env: DashboardEnv,
  route: RouteTarget,
  targetId: string,
  targetUrl: string | null,
): Promise<void> {
  const endpoint = restEndpoint(env, "want_routes");
  endpoint.searchParams.set("id", `eq.${route.id}`);
  endpoint.searchParams.set("target_id", `eq.${route.targetId}`);
  endpoint.searchParams.set("destination", "eq.calendar");
  endpoint.searchParams.set("status", "eq.created");
  endpoint.searchParams.set("select", "id,target_id");
  const response = await supabaseFetch(env, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ target_id: targetId, target_url: targetUrl, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("SCHEDULED_ACTION_UPDATE_CONFLICT", "Calendar route changed before replacement.", 409);
}

async function patchAction(
  env: DashboardEnv,
  current: StoredAction,
  changes: Record<string, unknown>,
): Promise<StoredAction> {
  const endpoint = restEndpoint(env, "scheduled_actions");
  endpoint.searchParams.set("select", "id,source_route_id,status,current_schedule,completed_at,note,reschedule_count,last_calendar_sync_at,created_at,updated_at");
  endpoint.searchParams.set("id", `eq.${current.id}`);
  endpoint.searchParams.set("status", `eq.${current.status}`);
  endpoint.searchParams.set("updated_at", `eq.${current.updatedAt}`);
  const response = await supabaseFetch(env, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw responseError(response, "scheduled_actions");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "scheduled_actions returned invalid data.");
  if (rows.length !== 1) throw new DashboardError("SCHEDULED_ACTION_UPDATE_CONFLICT", "Scheduled action changed before update.", 409);
  return normalizeAction(rows[0] as ScheduledActionRow);
}

async function recordScheduleHistory(
  env: DashboardEnv,
  actionId: number,
  previousSchedule: CalendarSchedule,
  nextSchedule: CalendarSchedule,
): Promise<void> {
  const endpoint = restEndpoint(env, "scheduled_action_schedule_history");
  const response = await supabaseFetch(env, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      scheduled_action_id: actionId,
      previous_schedule: previousSchedule,
      next_schedule: nextSchedule,
    }),
  });
  if (!response.ok) throw responseError(response, "scheduled_action_schedule_history");
}

export async function updateScheduledAction(env: DashboardEnv, input: ScheduledActionInput) {
  const current = await readActionForUpdate(env, input);
  if (input.command === "reschedule") {
    const route = await readRouteTarget(env, current.sourceRouteId);
    const event = await rescheduleGoogleCalendarEvent(env, route.targetId, input.schedule!, input.original.calendarEtag);
    const updated = await patchAction(env, current, {
      current_schedule: event.schedule,
      reschedule_count: current.rescheduleCount + 1,
      last_calendar_sync_at: new Date().toISOString(),
    });
    try {
      await recordScheduleHistory(env, current.id, input.original.schedule!, input.schedule!);
    } catch {
      // Calendar and current ToDo schedule are already updated. A later sync
      // still recovers the current state even if the optional audit insert fails.
    }
    return { id: updated.id, status: updated.status, schedule: updated.schedule, rescheduleCount: updated.rescheduleCount };
  }
  if (input.command === "recreate") {
    const route = await readRouteTarget(env, current.sourceRouteId);
    const existing = (await readGoogleCalendarEvents(env, [route.targetId])).get(route.targetId);
    if (existing?.status === "confirmed") {
      throw new DashboardError("SCHEDULED_ACTION_CALENDAR_EXISTS", "Calendar event still exists.", 409);
    }
    const event = await createReplacementGoogleCalendarEvent(env, {
      wantId: route.wantId,
      replacementKey: await replacementKey(current, input.schedule!),
      title: route.title,
      detail: route.detail,
      schedule: input.schedule!,
    });
    await replaceRouteTarget(env, route, event.targetId, event.targetUrl);
    const updated = await patchAction(env, current, {
      current_schedule: event.schedule,
      reschedule_count: current.rescheduleCount + 1,
      last_calendar_sync_at: new Date().toISOString(),
    });
    try {
      await recordScheduleHistory(env, current.id, input.original.schedule!, input.schedule!);
    } catch {
      // The new Calendar event and active route are already verified.
    }
    return { id: updated.id, status: updated.status, schedule: updated.schedule, rescheduleCount: updated.rescheduleCount };
  }

  const nextStatus: ScheduledActionStatus = input.command === "complete"
    ? "completed"
    : input.command === "skip"
      ? "skipped"
      : "pending";
  const updated = await patchAction(env, current, {
    status: nextStatus,
    completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    note: input.note,
  });
  return { id: updated.id, status: updated.status, completedAt: updated.completedAt, note: updated.note };
}
