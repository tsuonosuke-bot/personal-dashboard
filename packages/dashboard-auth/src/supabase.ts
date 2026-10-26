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
export const SUPABASE_TIMEOUT_MS = 15_000;

export class SupabaseTransportError extends Error {
  readonly code: "SUPABASE_TIMEOUT" | "SUPABASE_UNAVAILABLE";

  constructor(code: "SUPABASE_TIMEOUT" | "SUPABASE_UNAVAILABLE") {
    // Never retain fetch's error/cause: those may contain URLs or credentials.
    super(code === "SUPABASE_TIMEOUT" ? "Supabase request timed out." : "Could not reach Supabase.");
    this.name = "SupabaseTransportError";
    this.code = code;
  }
}

export function supabaseHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", apikey: key };
  // Current secret keys belong only in apikey; legacy service_role JWTs also need bearer auth.
  if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) headers.Authorization = `Bearer ${key}`;
  return { ...headers, ...extra };
}

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

/** One deadline includes response bodies and the single authentication retry.
 * Network errors, timeouts, 429 and 5xx are never replayed: a write may already have committed.
 * Only the precise future-issued JWT rejection is safe to retry, including RPC writes,
 * because PostgREST rejected authentication before executing the request. */
export async function fetchSupabase(
  input: URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; retryTransientAuth?: boolean } = {},
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? SUPABASE_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    let requestHeaders = init.headers;
    const key = headers.get("apikey");
    if (key && !headers.has("Authorization") && /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      requestHeaders = { ...Object.fromEntries(headers), Authorization: `Bearer ${key}` };
    }
    const request = { ...init, headers: requestHeaders, signal: controller.signal };
    const send = async (): Promise<Response> => {
      const response = await fetch(input, request);
      // Buffer within the deadline so a stalled body cannot hang the caller after headers arrive.
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    };
    const response = await send();
    if (options.retryTransientAuth === false || !(await isTransientAuthError(response))) return response;
    if (controller.signal.aborted) throw new Error("aborted");
    // A stream body cannot be replayed, even after a definite authentication rejection.
    if (init.body instanceof ReadableStream) return response;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(delay); controller.signal.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { clearTimeout(delay); controller.signal.removeEventListener("abort", cancel); reject(new Error("aborted")); };
      const delay = setTimeout(done, AUTH_RETRY_DELAY_MS);
      controller.signal.addEventListener("abort", cancel, { once: true });
      if (controller.signal.aborted) cancel();
    });
    return await send();
  } catch {
    throw new SupabaseTransportError(timedOut ? "SUPABASE_TIMEOUT" : "SUPABASE_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
