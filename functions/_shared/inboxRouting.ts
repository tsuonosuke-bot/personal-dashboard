import { DashboardError, publicError, type DashboardEnv } from "./dashboard.ts";
import {
  assertGoogleCalendarConnected,
  createGoogleCalendarEvent,
  parseCalendarSchedule,
} from "./googleCalendar.ts";
import { publicProjectError } from "./projects.ts";
import { connection, isPlainObject, supabaseFetch, type SupabaseConnection } from "./wantRouting.ts";

// Inboxの振り分けは inbox-route-v1 契約のDB関数に集約している。
// ここはブラウザの要求を形だけ確かめてRPCへ渡し、外部作成（Google Calendar）だけを担う。
export const INBOX_ROUTE_CONTRACT = "inbox-route-v1";
export const INBOX_ROUTE_ACTION_HEADER = "inbox-route";
const MAX_REQUEST_CHARS = 12_000;

export const INBOX_EXITS = [
  "calendar",
  "wish",
  "writing",
  "knowledge",
  "habit",
  "focus",
  "github",
  "journal",
  "defer",
  "archive",
  "project_create",
  "project_link",
  "close",
] as const;

type InboxExit = typeof INBOX_EXITS[number];
const exitSet = new Set<string>(INBOX_EXITS);

export interface InboxRouteInput {
  inboxId: number;
  exit: InboxExit;
  params: Record<string, unknown>;
  idempotencyKey: string;
}

type ValidationResult =
  | { ok: true; value: InboxRouteInput }
  | { ok: false; status: number; error: string };

export interface InboxRouteResult {
  contract: string;
  exit: string;
  state: "completed" | "awaiting_external" | "failed";
  replayed: boolean;
  inbox: { id: number; status: string; result: string | null } | null;
  want: { id: number; status: string; type: string; revisit_on: string | null } | null;
  route: {
    id: number;
    status: string;
    title: string;
    detail: string | null;
    target_id: string | null;
    target_url: string | null;
    destination_data: Record<string, unknown>;
  } | null;
  project_id: number | null;
}

// DB関数が raise する message と、公開用のエラーコード・HTTPステータスの対応
const RPC_ERRORS: Record<string, [string, number]> = {
  INBOX_ROUTE_INVALID: ["INBOX_ROUTE_INVALID", 400],
  INBOX_NOT_FOUND: ["INBOX_NOT_FOUND", 404],
  INBOX_ROUTE_CONFLICT: ["INBOX_UPDATE_CONFLICT", 409],
  IDEMPOTENCY_CONFLICT: ["INBOX_ROUTE_IDEMPOTENCY_CONFLICT", 409],
  ROUTE_NOT_FOUND: ["WANT_ROUTE_CONFLICT", 409],
  ROUTE_STATE_CONFLICT: ["WANT_ROUTE_CONFLICT", 409],
  FOCUS_ACTIVE_LIMIT: ["FOCUS_LIMIT_REACHED", 409],
  PROJECT_CONFLICT: ["PROJECT_UPDATE_CONFLICT", 409],
  PROJECT_NOT_OPEN: ["PROJECT_NOT_OPEN", 409],
  PROJECT_SOURCE_CONFLICT: ["PROJECT_SOURCE_CONFLICT", 409],
  PROJECT_SOURCE_ALREADY_LINKED: ["PROJECT_SOURCE_ALREADY_LINKED", 409],
  PROJECT_SOURCE_INVALID: ["PROJECT_SOURCE_INVALID", 400],
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateInboxRouteRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== INBOX_ROUTE_ACTION_HEADER) {
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

export async function readInboxRouteInput(request: Request): Promise<ValidationResult> {
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
  const keys = ["inboxId", "exit", "params", "idempotencyKey"];
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length || !keys.every((key) => key in value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.inboxId) || Number(value.inboxId) <= 0) {
    return { ok: false, status: 400, error: "Inbox IDが正しくありません。" };
  }
  if (typeof value.exit !== "string" || !exitSet.has(value.exit)) {
    return { ok: false, status: 400, error: "振り分け先が正しくありません。" };
  }
  if (!isPlainObject(value.params)) {
    return { ok: false, status: 400, error: "振り分け内容が正しくありません。" };
  }
  if (typeof value.idempotencyKey !== "string" || !isUuid(value.idempotencyKey)) {
    return { ok: false, status: 400, error: "処理IDが正しくありません。" };
  }
  // 内容の検証はDB関数が正本。ここでは予定の日時だけ先に確かめ、未接続時に余計な記録を作らない。
  if (value.exit === "calendar" && !parseCalendarSchedule(value.params.calendar)) {
    return { ok: false, status: 400, error: "Google Calendarへ登録する日付と時間を確認してください。" };
  }
  return {
    ok: true,
    value: {
      inboxId: Number(value.inboxId),
      exit: value.exit as InboxExit,
      params: value.params,
      idempotencyKey: value.idempotencyKey,
    },
  };
}

async function rpcError(response: Response, name: string): Promise<DashboardError> {
  if (response.status === 401 || response.status === 403) {
    return new DashboardError("SUPABASE_ACCESS_DENIED", `${name} returned ${response.status}.`);
  }
  let message = "";
  try {
    const body: unknown = await response.json();
    if (isPlainObject(body) && typeof body.message === "string") message = body.message;
  } catch {
    // Public errors never expose database detail.
  }
  const mapped = RPC_ERRORS[message];
  if (mapped) return new DashboardError(mapped[0], `${name} raised ${message}.`, mapped[1]);
  return new DashboardError("SUPABASE_REQUEST_FAILED", `${name} returned ${response.status}.`);
}

async function callRpc(
  connectionInfo: SupabaseConnection,
  name: string,
  body: Record<string, unknown>,
): Promise<InboxRouteResult> {
  const endpoint = new URL(`/rest/v1/rpc/${name}`, connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await rpcError(response, name);
  const result: unknown = await response.json();
  if (!isPlainObject(result) || result.contract !== INBOX_ROUTE_CONTRACT || typeof result.state !== "string") {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${name} returned invalid data.`);
  }
  return result as unknown as InboxRouteResult;
}

export async function routeInbox(env: DashboardEnv, input: InboxRouteInput): Promise<InboxRouteResult> {
  const connectionInfo = connection(env);
  if (input.exit === "calendar") await assertGoogleCalendarConnected(env);

  const result = await callRpc(connectionInfo, "route_inbox_item", {
    p_inbox_id: input.inboxId,
    p_exit: input.exit,
    p_params: input.params,
    p_idempotency_key: input.idempotencyKey,
  });
  if (result.state !== "awaiting_external") return result;

  const route = result.route;
  const schedule = parseCalendarSchedule(route?.destination_data?.calendar);
  if (!route || !result.want || !schedule) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "route_inbox_item returned invalid data.");
  }
  let target: { targetId: string; targetUrl: string };
  try {
    // Googleの予定IDは処理IDから決まるため、再送しても予定は1件のまま。
    target = await createGoogleCalendarEvent(env, {
      wantId: result.want.id,
      idempotencyKey: input.idempotencyKey,
      title: route.title,
      detail: route.detail,
      schedule,
    });
  } catch (error) {
    const failure = error instanceof DashboardError ? error : new DashboardError("WANT_ROUTE_FAILED", "Route failed.");
    try {
      await callRpc(connectionInfo, "fail_inbox_route", {
        p_idempotency_key: input.idempotencyKey,
        p_error_code: failure.code,
      });
    } catch {
      // The Inbox stays pending even if recording the failure also fails.
    }
    throw failure;
  }
  return callRpc(connectionInfo, "complete_inbox_route", {
    p_idempotency_key: input.idempotencyKey,
    p_target_id: target.targetId,
    p_target_url: target.targetUrl,
  });
}

export function publicInboxRouteError(error: unknown) {
  if (error instanceof DashboardError && error.code.startsWith("PROJECT_")) return publicProjectError(error);
  return publicError(error);
}
