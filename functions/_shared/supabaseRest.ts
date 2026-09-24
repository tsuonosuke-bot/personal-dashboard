export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export type SupabaseTable = "knowledge" | "quiz_log" | "speaking_practice_log" | "knowledge_mastery_history" | "idea_inbox" | "knowledge_insights";

interface QueryDefinition {
  table: SupabaseTable;
  params: URLSearchParams;
}

export interface SupabaseRequest extends QueryDefinition {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  count?: "exact";
}

export type SupabaseRowsResult =
  | { ok: true; rows: unknown[]; total: number | null }
  | { ok: false; response: Response };

export interface Pagination {
  limit: number;
  offset: number;
}

export type PaginationResult =
  | { ok: true; value: Pagination }
  | { ok: false; response: Response };

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1_000;

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function readPagination(request: Request): PaginationResult {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { ok: false, response: jsonResponse({ error: "リクエストURLが正しくありません。" }, 400) };
  }

  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : parseNonNegativeInteger(rawLimit);
  const offset = rawOffset === null ? 0 : parseNonNegativeInteger(rawOffset);
  if (limit === null || limit < 1 || limit > MAX_PAGE_SIZE) {
    return { ok: false, response: jsonResponse(
      { error: `limitは1〜${MAX_PAGE_SIZE}の整数で指定してください。` },
      400,
    ) };
  }
  if (offset === null) {
    return { ok: false, response: jsonResponse(
      { error: "offsetは0以上の整数で指定してください。" },
      400,
    ) };
  }
  return { ok: true, value: { limit, offset } };
}

function parseContentRange(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\/(\d+)$/);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) ? total : null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Method Not Allowed\n", {
    status: 405,
    headers: {
      Allow: allow,
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/** PostgRESTの `in.(...)` 値。カテゴリ名に含まれるカンマや括弧が区切りに化けないよう引用する。 */
export function inFilter(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replace(/[\\"]/g, "\\$&")}"`).join(",")})`;
}

export async function requestSupabaseRows(
  env: SupabaseEnv,
  query: SupabaseRequest,
): Promise<SupabaseRowsResult> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!rawUrl || !secretKey) {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続設定が未完了です。" },
      503,
    ) };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`/rest/v1/${query.table}`, rawUrl);
  } catch {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続先が正しくありません。" },
      503,
    ) };
  }

  if (endpoint.protocol !== "https:") {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続先はHTTPSである必要があります。" },
      503,
    ) };
  }

  endpoint.search = query.params.toString();

  try {
    const method = query.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      apikey: secretKey,
    };
    if (method === "GET" && query.count === "exact") {
      headers.Prefer = "count=exact";
    } else if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "return=representation";
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body: query.body === undefined ? undefined : JSON.stringify(query.body),
    });

    if (!response.ok) {
      console.error(
        `Supabase ${query.table} request failed with status ${response.status}`,
      );
      return { ok: false, response: jsonResponse(
        { error: method === "GET" ? "DBからデータを取得できませんでした。" : "DBの更新に失敗しました。" },
        502,
      ) };
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      console.error(`Supabase ${query.table} returned a non-array response`);
      return { ok: false, response: jsonResponse(
        { error: "DBから想定外の応答を受信しました。" },
        502,
      ) };
    }

    return {
      ok: true,
      rows: data,
      total: method === "GET" && query.count === "exact"
        ? parseContentRange(response.headers.get("Content-Range"))
        : null,
    };
  } catch (error) {
    console.error(
      `Supabase ${query.table} request failed`,
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, response: jsonResponse(
      { error: "DBへの接続中にエラーが発生しました。" },
      502,
    ) };
  }
}

export type SupabaseFunctionResult =
  | { ok: true; data: unknown }
  | { ok: false; response: Response };

/** Supabase RPC (`/rest/v1/rpc/:fn`) を呼び出す。戻り値の形はDB関数の戻り値型に依存する
 * （setof→配列、単一行→オブジェクト、スカラー→そのままの値）ため、呼び出し側で解釈する。 */
export async function requestSupabaseFunction(
  env: SupabaseEnv,
  name: string,
  args: Record<string, unknown>,
): Promise<SupabaseFunctionResult> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!rawUrl || !secretKey) {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続設定が未完了です。" },
      503,
    ) };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`/rest/v1/rpc/${name}`, rawUrl);
  } catch {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続先が正しくありません。" },
      503,
    ) };
  }
  if (endpoint.protocol !== "https:") {
    return { ok: false, response: jsonResponse(
      { error: "サーバーのDB接続先はHTTPSである必要があります。" },
      503,
    ) };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: secretKey,
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      console.error(`Supabase rpc ${name} request failed with status ${response.status}`);
      return { ok: false, response: jsonResponse(
        { error: "DBの処理に失敗しました。" },
        502,
      ) };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error(
      `Supabase rpc ${name} request failed`,
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, response: jsonResponse(
      { error: "DBへの接続中にエラーが発生しました。" },
      502,
    ) };
  }
}

export async function fetchSupabasePage(
  env: SupabaseEnv,
  query: QueryDefinition,
  pagination: Pagination,
): Promise<Response> {
  const params = new URLSearchParams(query.params);
  params.set("limit", String(pagination.limit));
  params.set("offset", String(pagination.offset));
  const result = await requestSupabaseRows(env, {
    table: query.table,
    params,
    count: "exact",
  });
  if (!result.ok) return result.response;
  return jsonResponse({
    items: result.rows,
    total: result.total,
    limit: pagination.limit,
    offset: pagination.offset,
  });
}
