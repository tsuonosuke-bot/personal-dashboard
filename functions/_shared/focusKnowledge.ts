import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { connection, isPlainObject, responseError, restEndpoint, supabaseFetch } from "./wantRouting.ts";

const MAX_REQUEST_CHARS = 1_000;
const MAX_QUERY_CHARS = 50;
const SEARCH_LIMIT = 10;
export const MAX_LINKS_PER_FOCUS = 10;
export const FOCUS_KNOWLEDGE_ACTIONS = ["focus-knowledge-link", "focus-knowledge-unlink"] as const;
export type FocusKnowledgeAction = typeof FOCUS_KNOWLEDGE_ACTIONS[number];

export interface LinkedKnowledge {
  id: string;
  title: string;
  category: string | null;
  url: string;
}

export interface FocusKnowledgeInput {
  focusId: number;
  knowledgeId: string;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function knowledgeUrl(id: string): string {
  return `/knowledge/?knowledge=${encodeURIComponent(id)}`;
}

function normalizeKnowledge(value: unknown): LinkedKnowledge | null {
  if (!isPlainObject(value) || typeof value.id !== "string" || !isUuid(value.id)) return null;
  return {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "タイトルなし",
    category: typeof value.category === "string" && value.category.trim() ? value.category : null,
    url: knowledgeUrl(value.id),
  };
}

// FocusIDごとの関連Knowledge。テーブル未作成などで読めない場合は null を返し、Focus本体の表示は止めない。
export async function loadFocusKnowledgeLinks(env: DashboardEnv): Promise<Map<number, LinkedKnowledge[]> | null> {
  const connectionInfo = connection(env);
  const endpoint = restEndpoint(connectionInfo, "focus_knowledge_links");
  endpoint.searchParams.set("select", "focus_id,knowledge_id,created_at,knowledge(id,title,category)");
  endpoint.searchParams.set("order", "created_at.asc");
  endpoint.searchParams.set("limit", "1000");
  let response: Response;
  try {
    response = await supabaseFetch(connectionInfo, endpoint);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows)) return null;
  const links = new Map<number, LinkedKnowledge[]>();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const focusId = Number(row.focus_id);
    const knowledge = normalizeKnowledge(row.knowledge);
    if (!Number.isSafeInteger(focusId) || !knowledge) continue;
    links.set(focusId, [...(links.get(focusId) || []), knowledge]);
  }
  return links;
}

export function validateFocusKnowledgeRequest(request: Request, action: FocusKnowledgeAction): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== action) return { status: 403, error: "紐づけ更新用ヘッダーがありません。" };
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) return { status: 413, error: "リクエストが大きすぎます。" };
  return null;
}

export async function readFocusKnowledgeInput(request: Request): Promise<ValidationResult<FocusKnowledgeInput>> {
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
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || !("focusId" in value) || !("knowledgeId" in value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.focusId) || Number(value.focusId) <= 0) {
    return { ok: false, status: 400, error: "Focus IDが正しくありません。" };
  }
  if (typeof value.knowledgeId !== "string" || !isUuid(value.knowledgeId)) {
    return { ok: false, status: 400, error: "Knowledge IDが正しくありません。" };
  }
  return { ok: true, value: { focusId: Number(value.focusId), knowledgeId: value.knowledgeId.toLowerCase() } };
}

export function readSearchQuery(url: URL): ValidationResult<string> {
  // LIKEのワイルドカードは検索語から外し、入力どおりの部分一致だけにする。
  const query = (url.searchParams.get("q") || "").replace(/[*%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length === 0) return { ok: false, status: 400, error: "検索語を入力してください。" };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, status: 400, error: `検索語は${MAX_QUERY_CHARS}文字以内で入力してください。` };
  return { ok: true, value: query };
}

export async function searchKnowledge(env: DashboardEnv, query: string): Promise<LinkedKnowledge[]> {
  const connectionInfo = connection(env);
  const endpoint = restEndpoint(connectionInfo, "knowledge");
  endpoint.searchParams.set("select", "id,title,category");
  endpoint.searchParams.set("archived", "eq.false");
  endpoint.searchParams.set("title", `ilike.*${query}*`);
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(SEARCH_LIMIT));
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "knowledge");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "knowledge returned invalid data.");
  return rows.map(normalizeKnowledge).filter((item): item is LinkedKnowledge => item !== null);
}

async function countLinks(env: DashboardEnv, focusId: number): Promise<number> {
  const connectionInfo = connection(env);
  const endpoint = restEndpoint(connectionInfo, "focus_knowledge_links");
  endpoint.searchParams.set("select", "knowledge_id");
  endpoint.searchParams.set("focus_id", `eq.${focusId}`);
  endpoint.searchParams.set("limit", String(MAX_LINKS_PER_FOCUS + 1));
  const response = await supabaseFetch(connectionInfo, endpoint);
  if (!response.ok) throw responseError(response, "focus_knowledge_links");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "focus_knowledge_links returned invalid data.");
  return rows.length;
}

export async function linkFocusKnowledge(env: DashboardEnv, input: FocusKnowledgeInput): Promise<void> {
  if (await countLinks(env, input.focusId) >= MAX_LINKS_PER_FOCUS) {
    throw new DashboardError("FOCUS_KNOWLEDGE_LIMIT", "Too many knowledge links for one Focus.", 409);
  }
  const connectionInfo = connection(env);
  const endpoint = restEndpoint(connectionInfo, "focus_knowledge_links");
  endpoint.searchParams.set("on_conflict", "focus_id,knowledge_id");
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ focus_id: input.focusId, knowledge_id: input.knowledgeId }),
  });
  if (response.ok) return;
  const detail = await response.text().catch(() => "");
  if (detail.includes("23503")) throw new DashboardError("FOCUS_KNOWLEDGE_NOT_FOUND", "Focus or knowledge was not found.", 404);
  throw responseError(response, "focus_knowledge_links");
}

export async function unlinkFocusKnowledge(env: DashboardEnv, input: FocusKnowledgeInput): Promise<void> {
  const connectionInfo = connection(env);
  const endpoint = restEndpoint(connectionInfo, "focus_knowledge_links");
  endpoint.searchParams.set("focus_id", `eq.${input.focusId}`);
  endpoint.searchParams.set("knowledge_id", `eq.${input.knowledgeId}`);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!response.ok) throw responseError(response, "focus_knowledge_links");
}
