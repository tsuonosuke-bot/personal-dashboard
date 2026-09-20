import { DashboardError, type DashboardEnv } from "./dashboard.ts";

const PAGE_SIZE = 1_000;
const MAX_REQUEST_CHARS = 20_000;
const MAX_TITLE_CHARS = 240;
const MAX_QUESTION_CHARS = 2_000;
const WRITING_SELECT = "id,source_route_id,source_want_id,title,question,status,created_at,updated_at";

export const WRITING_STATUSES = [
  "candidate", "researching", "outlining", "drafting", "completed", "on_hold", "archived",
] as const;
export type WritingStatus = (typeof WRITING_STATUSES)[number];
export const WRITING_WORKFLOW_STATUSES = ["candidate", "drafting", "completed"] as const;
export type WritingWorkflowStatus = (typeof WRITING_WORKFLOW_STATUSES)[number];

interface WritingRow {
  id?: unknown;
  source_route_id?: unknown;
  source_want_id?: unknown;
  title?: unknown;
  question?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface WritingTopic {
  id: number;
  sourceRouteId: number;
  sourceWantId: number;
  title: string;
  question: string | null;
  status: WritingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WritingUpdateInput {
  id: number;
  title: string;
  question: string | null;
  status: WritingWorkflowStatus;
  originalUpdatedAt: string;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

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

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function isWritingStatus(value: unknown): value is WritingStatus {
  return typeof value === "string" && (WRITING_STATUSES as readonly string[]).includes(value);
}

function isWritingWorkflowStatus(value: unknown): value is WritingWorkflowStatus {
  return typeof value === "string" && (WRITING_WORKFLOW_STATUSES as readonly string[]).includes(value);
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

async function supabaseFetch(
  connectionInfo: { url: URL; key: string },
  endpoint: URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      ...init,
      headers: { Accept: "application/json", apikey: connectionInfo.key, ...(init.headers || {}) },
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach writing_topics.");
  }
}

function responseError(response: Response): DashboardError {
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `writing_topics returned ${response.status}.`);
}

function normalizeWritingTopic(row: WritingRow): WritingTopic {
  const id = positiveInteger(row.id);
  const sourceRouteId = positiveInteger(row.source_route_id);
  const sourceWantId = positiveInteger(row.source_want_id);
  const createdAt = isoDate(row.created_at);
  const updatedAt = isoDate(row.updated_at);
  if (!id || !sourceRouteId || !sourceWantId || typeof row.title !== "string" || !row.title ||
      !isWritingStatus(row.status) || !createdAt || !updatedAt) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "writing_topics returned invalid data.");
  }
  return {
    id,
    sourceRouteId,
    sourceWantId,
    title: row.title,
    question: typeof row.question === "string" && row.question.length > 0 ? row.question : null,
    status: row.status,
    createdAt,
    updatedAt,
  };
}

export function normalizeWritingRows(rows: WritingRow[]): WritingTopic[] {
  return rows.map(normalizeWritingTopic).sort((left, right) =>
    (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt) || right.id - left.id);
}

function sortWritingTopics(items: WritingTopic[]): WritingTopic[] {
  return [...items].sort((left, right) =>
    (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt) || right.id - left.id);
}

export async function loadWriting(env: DashboardEnv) {
  const connectionInfo = connection(env);
  const items: WritingTopic[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL("/rest/v1/writing_topics", connectionInfo.url);
    endpoint.searchParams.set("select", WRITING_SELECT);
    endpoint.searchParams.set("order", "updated_at.desc,id.desc");
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const response = await supabaseFetch(connectionInfo, endpoint);
    if (!response.ok) throw responseError(response);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "writing_topics returned invalid data.");
    items.push(...normalizeWritingRows(rows as WritingRow[]));
    if (rows.length < PAGE_SIZE) break;
  }
  const sorted = sortWritingTopics(items);
  return {
    items: sorted,
    summary: {
      active: sorted.filter((item) => !["completed", "archived"].includes(item.status)).length,
      ideas: sorted.filter((item) => ["candidate", "researching", "outlining", "on_hold"].includes(item.status)).length,
      drafting: sorted.filter((item) => item.status === "drafting").length,
      completed: sorted.filter((item) => ["completed", "archived"].includes(item.status)).length,
    },
  };
}

export function validateWritingMutationRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "writing-update") {
    return { status: 403, error: "Writing更新用ヘッダーがありません。" };
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed || null;
}

export async function readWritingUpdateInput(request: Request): Promise<ValidationResult<WritingUpdateInput>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  const keys = ["id", "title", "question", "status", "originalUpdatedAt"];
  if (!isPlainObject(parsed) || !hasOnlyKeys(parsed, keys)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const id = positiveInteger(parsed.id);
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const question = nullableText(parsed.question, MAX_QUESTION_CHARS);
  const originalUpdatedAt = isoDate(parsed.originalUpdatedAt);
  if (!id) return { ok: false, status: 400, error: "Writing IDが正しくありません。" };
  if (!title || title.length > MAX_TITLE_CHARS) {
    return { ok: false, status: 400, error: `タイトルは1〜${MAX_TITLE_CHARS}文字で入力してください。` };
  }
  if (question === undefined) return { ok: false, status: 400, error: `論点は${MAX_QUESTION_CHARS}文字以内で入力してください。` };
  if (!isWritingWorkflowStatus(parsed.status)) return { ok: false, status: 400, error: "ステータスが正しくありません。" };
  if (!originalUpdatedAt) return { ok: false, status: 400, error: "編集前の更新日時が正しくありません。" };
  return {
    ok: true,
    value: { id, title, question, status: parsed.status, originalUpdatedAt },
  };
}

export async function updateWritingTopic(env: DashboardEnv, input: WritingUpdateInput): Promise<WritingTopic> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/writing_topics", connectionInfo.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("updated_at", `eq.${input.originalUpdatedAt}`);
  endpoint.searchParams.set("select", WRITING_SELECT);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      title: input.title,
      question: input.question,
      status: input.status,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw responseError(response);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "writing_topics returned invalid data.");
  if (rows.length === 0) throw new DashboardError("WRITING_UPDATE_CONFLICT", "Writing topic changed before update.", 409);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "writing_topics updated an unexpected number of rows.");
  return normalizeWritingTopic(rows[0] as WritingRow);
}
