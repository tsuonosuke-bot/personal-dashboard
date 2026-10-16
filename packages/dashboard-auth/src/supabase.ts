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

/** SupabaseがJWTの発行時刻を未来と判定して一時的に拒否したときだけ、少し待って1回やり直す。
 * PGRST303には期限切れやaudience不一致も含まれるため、コードだけで再試行を決めない。 */
const AUTH_RETRY_DELAY_MS = 300;

async function isTransientAuthError(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return false;
    const { code, message } = body as { code?: unknown; message?: unknown };
    const claimsError = code === "PGRST303" || response.headers.get("Proxy-Status")?.includes("PGRST303");
    return Boolean(claimsError) && typeof message === "string" && message.startsWith("JWT issued at future");
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
