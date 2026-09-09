export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

interface QueryDefinition {
  table: "knowledge" | "quiz_log";
  params: URLSearchParams;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function methodNotAllowed(): Response {
  return new Response("Method Not Allowed\n", {
    status: 405,
    headers: {
      Allow: "GET",
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function fetchSupabaseRows(
  env: SupabaseEnv,
  query: QueryDefinition,
): Promise<Response> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!rawUrl || !secretKey) {
    return jsonResponse(
      { error: "サーバーのDB接続設定が未完了です。" },
      503,
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`/rest/v1/${query.table}`, rawUrl);
  } catch {
    return jsonResponse(
      { error: "サーバーのDB接続先が正しくありません。" },
      503,
    );
  }

  if (endpoint.protocol !== "https:") {
    return jsonResponse(
      { error: "サーバーのDB接続先はHTTPSである必要があります。" },
      503,
    );
  }

  endpoint.search = query.params.toString();

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: secretKey,
      },
    });

    if (!response.ok) {
      console.error(
        `Supabase ${query.table} request failed with status ${response.status}`,
      );
      return jsonResponse(
        { error: "DBからデータを取得できませんでした。" },
        502,
      );
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      console.error(`Supabase ${query.table} returned a non-array response`);
      return jsonResponse(
        { error: "DBから想定外の応答を受信しました。" },
        502,
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error(
      `Supabase ${query.table} request failed`,
      error instanceof Error ? error.message : "unknown error",
    );
    return jsonResponse(
      { error: "DBへの接続中にエラーが発生しました。" },
      502,
    );
  }
}
