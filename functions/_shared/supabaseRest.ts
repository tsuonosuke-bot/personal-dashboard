export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export type SupabaseTable = "knowledge" | "quiz_log";

interface QueryDefinition {
  table: SupabaseTable;
  params: URLSearchParams;
}

export interface SupabaseRequest extends QueryDefinition {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

export type SupabaseRowsResult =
  | { ok: true; rows: unknown[] }
  | { ok: false; response: Response };

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
    if (method !== "GET") {
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

    return { ok: true, rows: data };
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

export async function fetchSupabaseRows(
  env: SupabaseEnv,
  query: QueryDefinition,
): Promise<Response> {
  const result = await requestSupabaseRows(env, query);
  return result.ok ? jsonResponse(result.rows) : result.response;
}
