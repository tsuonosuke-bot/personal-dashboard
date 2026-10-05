export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
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

export function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method Not Allowed\n", {
    status: 405,
    headers: {
      Allow: allow,
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/** 同じキーの同時リクエストのうち片方だけが、Supabase側でJWTの検証エラー（PGRST303）として
 * 401になることがある。拒否されたリクエストは実行されていないので、少し待って1回だけやり直す。 */
const AUTH_RETRY_DELAY_MS = 300;

async function isTransientAuthError(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  if (response.headers.get("Proxy-Status")?.includes("PGRST303")) return true;
  try {
    const body: unknown = await response.clone().json();
    return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "PGRST303";
  } catch {
    return false;
  }
}

/** Supabase REST APIへのfetch。一時的な認証エラーのときだけ1回やり直す。 */
export async function fetchSupabase(input: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!(await isTransientAuthError(response))) return response;
  console.warn(`Supabase ${input.pathname} rejected the key transiently (PGRST303); retrying once`);
  await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
  return fetch(input, init);
}
