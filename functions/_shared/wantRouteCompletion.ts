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

// Knowledge DBへの登録はダッシュボードの外（LLMとの会話）で行うため、
// 登録済みになった候補は利用者がここで「登録済み」に変える。
const MAX_REQUEST_CHARS = 1_000;
export const KNOWLEDGE_COMPLETE_ACTION = "want-route-complete";
const MANUAL_TARGET_ID = "manual";

export interface KnowledgeCompletionInput {
  routeId: number;
  knowledgeId: string | null;
  original: { destination: "knowledge"; status: "planned" };
}

type ValidationResult =
  | { ok: true; value: KnowledgeCompletionInput }
  | { ok: false; status: number; error: string };

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateKnowledgeCompletionRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== KNOWLEDGE_COMPLETE_ACTION) {
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

export async function readKnowledgeCompletionInput(request: Request): Promise<ValidationResult> {
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
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["routeId", "knowledgeId", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.routeId) || Number(value.routeId) <= 0) {
    return { ok: false, status: 400, error: "振り分けIDが正しくありません。" };
  }
  if (value.knowledgeId !== null && typeof value.knowledgeId !== "string") {
    return { ok: false, status: 400, error: "Knowledge IDが正しくありません。" };
  }
  const knowledgeId = typeof value.knowledgeId === "string" ? value.knowledgeId.trim() : "";
  if (knowledgeId.length > 0 && !isUuid(knowledgeId)) {
    return { ok: false, status: 400, error: "Knowledge IDはナレッジDBのUUIDを入力してください。" };
  }
  if (!isPlainObject(value.original) || !hasOnlyKeys(value.original, ["destination", "status"]) ||
      value.original.destination !== "knowledge" || value.original.status !== "planned") {
    return { ok: false, status: 400, error: "更新前の振り分け情報が正しくありません。" };
  }

  return {
    ok: true,
    value: {
      routeId: Number(value.routeId),
      knowledgeId: knowledgeId.length > 0 ? knowledgeId : null,
      original: { destination: "knowledge", status: "planned" },
    },
  };
}

async function readRoute(connectionInfo: SupabaseConnection, routeId: number): Promise<StoredRoute> {
  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("select", routeSelect);
  endpoint.searchParams.set("id", `eq.${routeId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) {
    throw new DashboardError("KNOWLEDGE_ROUTE_NOT_FOUND", "Knowledge route was not found.", 404);
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

export async function completeKnowledgeRoute(
  env: DashboardEnv,
  input: KnowledgeCompletionInput,
): Promise<StoredRoute> {
  const connectionInfo = connection(env);
  const route = await readRoute(connectionInfo, input.routeId);
  if (route.destination !== "knowledge") {
    throw new DashboardError("KNOWLEDGE_ROUTE_CONFLICT", "Route is not a Knowledge candidate.", 409);
  }
  // 二重送信でも同じ結果を返し、登録済みの対象IDは書き換えない。
  if (route.status === "created") return route;
  if (route.status !== "planned") {
    throw new DashboardError("KNOWLEDGE_ROUTE_CONFLICT", "Knowledge route changed before completion.", 409);
  }
  if (input.knowledgeId) await assertKnowledgeExists(connectionInfo, input.knowledgeId);

  const endpoint = restEndpoint(connectionInfo, "want_routes");
  endpoint.searchParams.set("id", `eq.${input.routeId}`);
  endpoint.searchParams.set("destination", "eq.knowledge");
  endpoint.searchParams.set("status", "eq.planned");
  endpoint.searchParams.set("select", routeSelect);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status: "created",
      target_id: input.knowledgeId || MANUAL_TARGET_ID,
      target_url: input.knowledgeId ? `/knowledge/?knowledge=${encodeURIComponent(input.knowledgeId)}` : null,
      error_code: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw responseError(response, "want_routes");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  if (rows.length !== 1) {
    throw new DashboardError("KNOWLEDGE_ROUTE_CONFLICT", "Knowledge route changed before completion.", 409);
  }
  return normalizeRoute(rows[0] as RouteRow);
}
