import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  connection,
  isPlainObject,
  normalizeRoute,
  responseError,
  restEndpoint,
  routeSelect,
  supabaseFetch,
  type RouteRow,
  type StoredRoute,
  type SupabaseConnection,
} from "./wantRouting.ts";

// Knowledge DBへの登録とGitHub Issueの作成はダッシュボードの外（LLMとの会話）で行うため、
// 登録済みになった候補は利用者がここで「登録済み」に変える。
const MAX_REQUEST_CHARS = 1_000;
export const ROUTE_COMPLETE_ACTION = "want-route-complete";
const MANUAL_TARGET_ID = "manual";
const GITHUB_ISSUE_URL = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}\/issues\/([1-9][0-9]{0,9})$/;

export type CompletableDestination = "knowledge" | "github";

export type RouteCompletionInput =
  | { routeId: number; destination: "knowledge"; knowledgeId: string | null }
  | { routeId: number; destination: "github"; issueUrl: string | null; issueNumber: string | null };

type ValidationResult =
  | { ok: true; value: RouteCompletionInput }
  | { ok: false; status: number; error: string };

const errorCodes = {
  knowledge: { notFound: "KNOWLEDGE_ROUTE_NOT_FOUND", conflict: "KNOWLEDGE_ROUTE_CONFLICT" },
  github: { notFound: "GITHUB_ROUTE_NOT_FOUND", conflict: "GITHUB_ROUTE_CONFLICT" },
} as const;

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateRouteCompletionRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== ROUTE_COMPLETE_ACTION) {
    return { status: 403, error: "登録済み更新用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

function readOriginal(value: unknown): CompletableDestination | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["destination", "status"]) || value.status !== "planned") return null;
  return value.destination === "knowledge" || value.destination === "github" ? value.destination : null;
}

export async function readRouteCompletionInput(request: Request): Promise<ValidationResult> {
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
  if (!isPlainObject(value)) return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  const destination = readOriginal(value.original);
  if (!destination) return { ok: false, status: 400, error: "更新前の振り分け情報が正しくありません。" };
  const targetKey = destination === "knowledge" ? "knowledgeId" : "issueUrl";
  if (!hasOnlyKeys(value, ["routeId", targetKey, "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.routeId) || Number(value.routeId) <= 0) {
    return { ok: false, status: 400, error: "振り分けIDが正しくありません。" };
  }
  const routeId = Number(value.routeId);
  const target = value[targetKey];
  if (target !== null && typeof target !== "string") {
    return { ok: false, status: 400, error: destination === "knowledge" ? "Knowledge IDが正しくありません。" : "Issue URLが正しくありません。" };
  }
  const trimmed = typeof target === "string" ? target.trim() : "";

  if (destination === "knowledge") {
    if (trimmed.length > 0 && !isUuid(trimmed)) {
      return { ok: false, status: 400, error: "Knowledge IDはナレッジDBのUUIDを入力してください。" };
    }
    return { ok: true, value: { routeId, destination, knowledgeId: trimmed || null } };
  }

  if (trimmed.length === 0) return { ok: true, value: { routeId, destination, issueUrl: null, issueNumber: null } };
  const match = GITHUB_ISSUE_URL.exec(trimmed);
  if (!match) {
    return { ok: false, status: 400, error: "Issue URLは https://github.com/<owner>/<repo>/issues/<番号> の形式で入力してください。" };
  }
  return { ok: true, value: { routeId, destination, issueUrl: trimmed, issueNumber: match[1] } };
}

async function readRoute(connectionInfo: SupabaseConnection, input: RouteCompletionInput): Promise<StoredRoute> {
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("select", routeSelect);
  endpoint.searchParams.set("id", `eq.${input.routeId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) {
    throw new DashboardError(errorCodes[input.destination].notFound, "Route was not found.", 404);
  }
  return normalizeRoute(rows[0] as RouteRow);
}

async function assertKnowledgeExists(connectionInfo: SupabaseConnection, knowledgeId: string): Promise<void> {
  const endpoint = restEndpoint(connectionInfo, "knowledge");
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("id", `eq.${knowledgeId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "knowledge");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "knowledge returned invalid data.");
  if (rows.length !== 1) {
    throw new DashboardError("KNOWLEDGE_ENTRY_NOT_FOUND", "Knowledge entry was not found.", 404);
  }
}

function completionTarget(input: RouteCompletionInput): { targetId: string; targetUrl: string | null } {
  if (input.destination === "knowledge") {
    return input.knowledgeId
      ? { targetId: input.knowledgeId, targetUrl: `/knowledge/?knowledge=${encodeURIComponent(input.knowledgeId)}` }
      : { targetId: MANUAL_TARGET_ID, targetUrl: null };
  }
  return input.issueUrl && input.issueNumber
    ? { targetId: input.issueNumber, targetUrl: input.issueUrl }
    : { targetId: MANUAL_TARGET_ID, targetUrl: null };
}

export async function completeWantRoute(env: DashboardEnv, input: RouteCompletionInput): Promise<StoredRoute> {
  const connectionInfo = connection(env);
  const codes = errorCodes[input.destination];
  const route = await readRoute(connectionInfo, input);
  if (route.destination !== input.destination) {
    throw new DashboardError(codes.conflict, "Route destination does not match.", 409);
  }
  // 二重送信でも同じ結果を返し、登録済みの対象IDは書き換えない。
  if (route.status === "created") return route;
  if (route.status !== "planned") {
    throw new DashboardError(codes.conflict, "Route changed before completion.", 409);
  }
  if (input.destination === "knowledge" && input.knowledgeId) {
    await assertKnowledgeExists(connectionInfo, input.knowledgeId);
  }

  const target = completionTarget(input);
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("id", `eq.${input.routeId}`);
  endpoint.searchParams.set("destination", `eq.${input.destination}`);
  endpoint.searchParams.set("status", "eq.planned");
  endpoint.searchParams.set("select", routeSelect);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status: "created",
      target_id: target.targetId,
      target_url: target.targetUrl,
      error_code: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) {
    throw new DashboardError(codes.conflict, "Route changed before completion.", 409);
  }
  return normalizeRoute(rows[0] as RouteRow);
}
