/** Durable, resumable Project -> Calendar -> canonical ToDo creation. */
import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";
import { isRecord, validProjectTimestamp } from "./projectActionTodos.ts";
import { validateProjectMutationRequest } from "./projects.ts";
import {
  configured,
  forgetGoogleAccessToken,
  googleAccessToken,
} from "./googleCalendarConnection.ts";
import {
  CALENDAR_API,
  matchesEvent,
  parseCalendarSchedule,
  schedulePayload,
  snapshotFromEvent,
  validGoogleUrl,
  type CalendarSchedule,
  type GoogleCalendarEventSnapshot,
} from "./googleCalendarModel.ts";

export interface ProjectScheduleInput {
  actionId: number;
  actionUpdatedAt: string;
  projectUpdatedAt: string;
  requestId: string;
  content?: string;
  calendar: CalendarSchedule;
}
export interface ProjectScheduleOperation {
  requestId: string;
  actionId: number;
  projectId: number;
  actionUpdatedAt: string;
  projectUpdatedAt: string;
  content: string;
  calendar: CalendarSchedule;
  stage: "planned" | "calendar_created" | "todo_created" | "linked";
  eventId: string;
  calendarUrl: string | null;
  calendarEtag: string | null;
  todoId: number | null;
  errorCode: string | null;
}
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const projectScheduleEventId = (requestId: string) =>
  `pc${requestId.toLowerCase().replace(/-/g, "")}`;
export const validateProjectScheduleRequest = (request: Request) =>
  validateProjectMutationRequest(request, "project-schedule-create");

export async function readProjectScheduleInput(request: Request) {
  let value: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 6000)
      return { ok: false as const, status: 413, error: "リクエストが大きすぎます。" };
    value = JSON.parse(raw);
  } catch {
    return { ok: false as const, status: 400, error: "JSONの形式が正しくありません。" };
  }
  const keys = [
    "actionId",
    "actionUpdatedAt",
    "projectUpdatedAt",
    "requestId",
    "calendar",
    "content",
  ];
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    !positiveId(value.actionId) ||
    !validProjectTimestamp(value.actionUpdatedAt) ||
    !validProjectTimestamp(value.projectUpdatedAt) ||
    !uuid(value.requestId) ||
    (value.content !== undefined &&
      (typeof value.content !== "string" || !value.content.trim() || value.content.length > 500))
  ) {
    return {
      ok: false as const,
      status: 400,
      error: "ActionとProjectの最新情報を確認してください。",
    };
  }
  const calendar = parseCalendarSchedule(value.calendar);
  if (!calendar)
    return {
      ok: false as const,
      status: 400,
      error: "日付・開始終了時刻・タイムゾーンを確認してください。",
    };
  return {
    ok: true as const,
    value: {
      actionId: value.actionId,
      actionUpdatedAt: value.actionUpdatedAt,
      projectUpdatedAt: value.projectUpdatedAt,
      requestId: value.requestId.toLowerCase(),
      ...(typeof value.content === "string" ? { content: value.content.trim() } : {}),
      calendar,
    } as ProjectScheduleInput,
  };
}

function endpoint(env: DashboardEnv, path: string): URL {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim())
    throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(`/rest/v1/${path}`, env.SUPABASE_URL.trim());
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "Invalid Supabase URL.", 503);
  }
  if (url.protocol !== "https:")
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "Invalid Supabase URL.", 503);
  return url;
}
async function db(env: DashboardEnv, url: URL, body?: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchSupabase(url, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: supabaseHeaders(env.SUPABASE_SECRET_KEY!.trim(), {
        "Content-Type": "application/json",
      }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach Project schedules.");
  }
  if (!response.ok) {
    const detail = await response.text();
    const code = [
      "SCHEDULE_REQUEST_CONFLICT",
      "SCHEDULE_OPERATION_CONFLICT",
      "ACTION_CONFLICT",
      "PROJECT_CONFLICT",
      "PROJECT_NOT_OPEN",
      "TODO_ALREADY_LINKED",
      "TODO_CONFLICT",
    ].find((marker) => detail.includes(marker));
    if (code)
      throw new DashboardError(code, "Project schedule changed. Confirm the latest state.", 409);
    throw new DashboardError(
      response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED",
      "Could not save Project schedule.",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Project schedule response.");
  }
}
export function normalizeProjectScheduleOperation(value: unknown): ProjectScheduleOperation {
  if (
    !isRecord(value) ||
    !uuid(value.request_id) ||
    !positiveId(value.action_id) ||
    !positiveId(value.project_id) ||
    !validProjectTimestamp(value.action_updated_at) ||
    !validProjectTimestamp(value.project_updated_at) ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    value.content.length > 500 ||
    !["planned", "calendar_created", "todo_created", "linked"].includes(String(value.stage)) ||
    value.event_id !== projectScheduleEventId(value.request_id) ||
    (value.todo_id !== null && !positiveId(value.todo_id)) ||
    (value.calendar_url !== null && !validGoogleUrl(value.calendar_url)) ||
    (value.calendar_etag !== null && typeof value.calendar_etag !== "string") ||
    (value.error_code !== null && typeof value.error_code !== "string")
  ) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Project schedule operation.");
  }
  const calendar = parseCalendarSchedule(value.calendar);
  if (
    !calendar ||
    (value.stage !== "planned" && (!value.calendar_etag || !value.calendar_url)) ||
    (["todo_created", "linked"].includes(String(value.stage)) && !positiveId(value.todo_id))
  ) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Incomplete Project schedule operation.");
  }
  return {
    requestId: value.request_id,
    actionId: value.action_id,
    projectId: value.project_id,
    actionUpdatedAt: value.action_updated_at,
    projectUpdatedAt: value.project_updated_at,
    content: value.content,
    calendar,
    stage: value.stage as ProjectScheduleOperation["stage"],
    eventId: String(value.event_id),
    calendarUrl: value.calendar_url as string | null,
    calendarEtag: value.calendar_etag as string | null,
    todoId: value.todo_id as number | null,
    errorCode: value.error_code as string | null,
  };
}
export async function getProjectScheduleOperation(
  env: DashboardEnv,
  actionId: number,
): Promise<ProjectScheduleOperation | null> {
  const url = endpoint(env, "project_schedule_operations");
  url.searchParams.set("action_id", `eq.${actionId}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "2");
  const rows = await db(env, url);
  if (!Array.isArray(rows) || rows.length > 1)
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Project schedule response.");
  return rows.length ? normalizeProjectScheduleOperation(rows[0]) : null;
}
async function rpc(env: DashboardEnv, name: string, body: Record<string, unknown>) {
  return normalizeProjectScheduleOperation(await db(env, endpoint(env, `rpc/${name}`), body));
}
function googleError(response: Response): never {
  if (response.status === 401) forgetGoogleAccessToken();
  throw new DashboardError(
    response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED",
    "Could not confirm Google Calendar event.",
    response.status === 429 ? 429 : 502,
  );
}

/** GET before INSERT recovers response loss; known created events are never recreated or overwritten. */
export async function ensureProjectCalendarEvent(
  env: DashboardEnv,
  operation: ProjectScheduleOperation,
): Promise<GoogleCalendarEventSnapshot> {
  if (!configured(env))
    throw new DashboardError(
      "GOOGLE_CALENDAR_NOT_CONFIGURED",
      "Google Calendar is not configured.",
      503,
    );
  const accessToken = await googleAccessToken(env);
  const collection = new URL(`${CALENDAR_API}/calendars/primary/events`);
  const item = new URL(`${collection}/${operation.eventId}`);
  item.searchParams.set("fields", "id,etag,htmlLink,status,summary,start,end");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const expected = {
    id: operation.eventId,
    summary: operation.content,
    description: `Personal Dashboard Project #${operation.projectId} / Action #${operation.actionId}`,
    ...schedulePayload(operation.calendar),
  };
  const call = async (url: URL, init?: RequestInit) => {
    try {
      return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new DashboardError(
        "GOOGLE_CALENDAR_UNAVAILABLE",
        "Calendar result is unknown; resume the saved operation.",
      );
    }
  };
  let response = await call(item);
  if (response.status === 404 && operation.stage === "planned") {
    collection.searchParams.set("sendUpdates", "none");
    const created = await call(collection, { method: "POST", body: JSON.stringify(expected) });
    if (!created.ok && created.status !== 409) googleError(created);
    response = await call(item);
  }
  if (response.status === 404 || response.status === 410)
    throw new DashboardError(
      "GOOGLE_CALENDAR_EVENT_MISSING",
      "The created Calendar event is missing; no replacement was created.",
      409,
    );
  if (!response.ok) googleError(response);
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    !matchesEvent(value, expected) ||
    !validGoogleUrl(value.htmlLink) ||
    typeof value.etag !== "string" ||
    !value.etag ||
    (operation.calendarEtag !== null && operation.calendarEtag !== value.etag)
  ) {
    throw new DashboardError(
      "GOOGLE_CALENDAR_EVENT_CONFLICT",
      "The Calendar event changed; inspect the existing event before resuming.",
      409,
    );
  }
  return snapshotFromEvent(operation.eventId, value);
}

export async function createProjectSchedule(
  env: DashboardEnv,
  input: ProjectScheduleInput,
): Promise<ProjectScheduleOperation> {
  // The durable intent and snapshots commit BEFORE any external creation.
  let operation = await rpc(env, "begin_project_schedule", { p_request: input });
  if (operation.stage === "linked") return operation;
  try {
    const event = await ensureProjectCalendarEvent(env, operation);
    operation = await rpc(env, "record_project_schedule_calendar", {
      p_request_id: operation.requestId,
      p_event_id: event.targetId,
      p_calendar_url: event.targetUrl,
      p_calendar_etag: event.etag,
    });
    operation = await rpc(env, "save_project_schedule_todo", { p_request_id: operation.requestId });
    return await rpc(env, "finish_project_schedule", { p_request_id: operation.requestId });
  } catch (error) {
    // Never compensate with DELETE: an existing event/ToDo is user data.
    try {
      await db(env, endpoint(env, "rpc/fail_project_schedule"), {
        p_request_id: operation.requestId,
        p_error_code: error instanceof DashboardError ? error.code : "PROJECT_SCHEDULE_FAILED",
      });
    } catch {
      /* The durable request still recovers result loss. */
    }
    throw error;
  }
}

export function publicProjectScheduleError(error: unknown) {
  const code = error instanceof DashboardError ? error.code : "PROJECT_SCHEDULE_FAILED";
  const messages: Record<string, string> = {
    GOOGLE_CALENDAR_NOT_CONFIGURED:
      "Google Calendar接続を確認してください。入力は保持されています。",
    GOOGLE_CALENDAR_NOT_CONNECTED: "Google Calendarに接続してから同じ予定作成を再開してください。",
    GOOGLE_CALENDAR_RECONNECT_REQUIRED:
      "Google Calendarに再接続してから同じ予定作成を再開してください。",
    GOOGLE_CALENDAR_ACCESS_DENIED:
      "Google Calendarの権限を確認してから同じ予定作成を再開してください。",
    GOOGLE_CALENDAR_EVENT_CONFLICT:
      "作成対象のCalendar予定が変更されています。既存予定を確認してください。",
    GOOGLE_CALENDAR_EVENT_MISSING: "作成済みの予定が見つかりません。Calendarを確認してください。",
    SCHEDULE_REQUEST_CONFLICT:
      "このActionには保存済みの予定作成があります。保存済みの内容を確認して再開してください。",
  };
  return {
    code,
    status: error instanceof DashboardError ? error.status : 502,
    message:
      messages[code] ??
      "予定作成の結果を確認してください。作成済みの予定・ToDoを保持したまま、最新のAction情報で再開できます。",
  };
}
