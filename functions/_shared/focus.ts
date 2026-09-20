import { DashboardError, type DashboardEnv } from "./dashboard.ts";

const MAX_REQUEST_CHARS = 16_000;
const MAX_CONTENT_CHARS = 240;
const MAX_NOTE_CHARS = 2_000;
const PAGE_SIZE = 1_000;
export const FOCUS_LIMIT = 5;

const FOCUS_SELECT = "id,source_route_id,source_want_id,content,note,status,sort_order,created_at,updated_at";

export interface FocusRow {
  id?: unknown;
  source_route_id?: unknown;
  source_want_id?: unknown;
  content?: unknown;
  note?: unknown;
  status?: unknown;
  sort_order?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface FocusItem {
  id: number;
  sourceRouteId: number;
  sourceWantId: number;
  content: string;
  note: string | null;
  status: "active" | "archived";
  sortOrder: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface FocusSnapshot {
  content: string;
  note: string | null;
  status: "active" | "archived";
  sortOrder: number | null;
}

export interface FocusUpdateInput {
  id: number;
  content: string;
  note: string | null;
  status: "active" | "archived";
  original: FocusSnapshot;
}

export interface FocusReorderInput {
  ids: number[];
  originalIds: number[];
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

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

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
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

async function supabaseFetch(
  connectionInfo: SupabaseConnection,
  endpoint: URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      ...init,
      headers: {
        Accept: "application/json",
        apikey: connectionInfo.key,
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach focus_items.");
  }
}

async function focusResponseError(response: Response): Promise<DashboardError> {
  const detail = await response.text().catch(() => "");
  if (detail.includes("FOCUS_ACTIVE_LIMIT")) {
    return new DashboardError("FOCUS_LIMIT_REACHED", "The active Focus board is full.", 409);
  }
  if (detail.includes("FOCUS_REORDER_CONFLICT")) {
    return new DashboardError("FOCUS_REORDER_CONFLICT", "Focus order changed before update.", 409);
  }
  if (detail.includes("FOCUS_REORDER_INVALID")) {
    return new DashboardError("FOCUS_REORDER_INVALID", "Focus reorder request is invalid.", 400);
  }
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `focus_items returned ${response.status}.`);
}

function normalizeFocusItem(row: FocusRow): FocusItem {
  const id = positiveInteger(row.id);
  const sourceRouteId = positiveInteger(row.source_route_id);
  const sourceWantId = positiveInteger(row.source_want_id);
  const status = row.status === "active" || row.status === "archived" ? row.status : null;
  const sortOrder = nullableInteger(row.sort_order);
  if (!id || !sourceRouteId || !sourceWantId || typeof row.content !== "string" || !status) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_items returned invalid data.");
  }
  return {
    id,
    sourceRouteId,
    sourceWantId,
    content: row.content,
    note: typeof row.note === "string" && row.note.length > 0 ? row.note : null,
    status,
    sortOrder,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

function sortFocusItems(items: FocusItem[]): FocusItem[] {
  return [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    if (left.status === "active") {
      return (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
        || (left.createdAt || "").localeCompare(right.createdAt || "")
        || left.id - right.id;
    }
    return (right.updatedAt || right.createdAt || "").localeCompare(left.updatedAt || left.createdAt || "")
      || right.id - left.id;
  });
}

export function normalizeFocusRows(rows: FocusRow[]): FocusItem[] {
  return sortFocusItems(rows.map(normalizeFocusItem));
}

export async function loadFocus(env: DashboardEnv) {
  const connectionInfo = connection(env);
  const items: FocusItem[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL("/rest/v1/focus_items", connectionInfo.url);
    endpoint.searchParams.set("select", FOCUS_SELECT);
    endpoint.searchParams.set("order", "status.asc,sort_order.asc.nullslast,created_at.asc,id.asc");
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const response = await supabaseFetch(connectionInfo, endpoint);
    if (!response.ok) throw await focusResponseError(response);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_items returned invalid data.");
    items.push(...normalizeFocusRows(rows as FocusRow[]));
    if (rows.length < PAGE_SIZE) break;
  }
  const sorted = sortFocusItems(items);
  return {
    items: sorted,
    activeCount: sorted.filter((item) => item.status === "active").length,
    limit: FOCUS_LIMIT,
  };
}

export function validateFocusMutationRequest(
  request: Request,
  actionHeader: "focus-update" | "focus-reorder",
): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return { status: 403, error: "許可されていない送信元です。" };
  }
  if (request.headers.get("X-Dashboard-Action") !== actionHeader) {
    return { status: 403, error: "Focus更新用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

async function readJson(request: Request): Promise<ValidationResult<unknown>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) {
    return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
}

function validStatus(value: unknown): value is FocusItem["status"] {
  return value === "active" || value === "archived";
}

function validNote(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_NOTE_CHARS);
}

function validSnapshot(value: unknown): value is FocusSnapshot {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["content", "note", "status", "sortOrder"])) return false;
  return typeof value.content === "string"
    && value.content.length > 0
    && value.content.length <= MAX_CONTENT_CHARS
    && validNote(value.note)
    && validStatus(value.status)
    && (value.sortOrder === null || Number.isSafeInteger(value.sortOrder));
}

export async function readFocusUpdateInput(request: Request): Promise<ValidationResult<FocusUpdateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "content", "note", "status", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const id = positiveInteger(value.id);
  if (!id) return { ok: false, status: 400, error: "Focus IDが正しくありません。" };
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return { ok: false, status: 400, error: "Focusの言葉を入力してください。" };
  }
  const content = value.content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    return { ok: false, status: 400, error: `Focusの言葉は${MAX_CONTENT_CHARS}文字以内で入力してください。` };
  }
  if (!validNote(value.note)) return { ok: false, status: 400, error: "補足が正しくありません。" };
  const note = typeof value.note === "string" && value.note.trim().length > 0 ? value.note.trim() : null;
  if ((note?.length || 0) > MAX_NOTE_CHARS) {
    return { ok: false, status: 400, error: `補足は${MAX_NOTE_CHARS}文字以内で入力してください。` };
  }
  if (!validStatus(value.status)) return { ok: false, status: 400, error: "ステータスが正しくありません。" };
  if (!validSnapshot(value.original)) return { ok: false, status: 400, error: "編集前のFocus情報が正しくありません。" };
  return { ok: true, value: { id, content, note, status: value.status, original: value.original } };
}

function validIdList(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length <= FOCUS_LIMIT
    && value.every((id) => Number.isSafeInteger(id) && Number(id) > 0)
    && new Set(value).size === value.length;
}

export async function readFocusReorderInput(request: Request): Promise<ValidationResult<FocusReorderInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["ids", "originalIds"]) ||
      !validIdList(value.ids) || !validIdList(value.originalIds) || value.ids.length !== value.originalIds.length) {
    return { ok: false, status: 400, error: "並び順の形式が正しくありません。" };
  }
  const desired = new Set(value.ids);
  if (!value.originalIds.every((id) => desired.has(id))) {
    return { ok: false, status: 400, error: "並び替えるFocusが一致しません。" };
  }
  return { ok: true, value: { ids: value.ids, originalIds: value.originalIds } };
}

function setSnapshotFilter(endpoint: URL, name: string, value: string | number | null): void {
  endpoint.searchParams.set(name, value === null ? "is.null" : `eq.${value}`);
}

export async function updateFocusItem(env: DashboardEnv, input: FocusUpdateInput): Promise<FocusItem> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/focus_items", connectionInfo.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  setSnapshotFilter(endpoint, "content", input.original.content);
  setSnapshotFilter(endpoint, "note", input.original.note);
  setSnapshotFilter(endpoint, "status", input.original.status);
  setSnapshotFilter(endpoint, "sort_order", input.original.sortOrder);
  endpoint.searchParams.set("select", FOCUS_SELECT);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ content: input.content, note: input.note, status: input.status }),
  });
  if (!response.ok) throw await focusResponseError(response);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_items returned invalid data.");
  if (rows.length === 0) throw new DashboardError("FOCUS_UPDATE_CONFLICT", "Focus changed before update.", 409);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_items updated an unexpected number of rows.");
  return normalizeFocusItem(rows[0] as FocusRow);
}

export async function reorderFocusItems(env: DashboardEnv, input: FocusReorderInput): Promise<FocusItem[]> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/reorder_focus_items", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_ids: input.ids, p_original_ids: input.originalIds }),
  });
  if (!response.ok) throw await focusResponseError(response);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_items returned invalid data.");
  return normalizeFocusRows(rows as FocusRow[]);
}
