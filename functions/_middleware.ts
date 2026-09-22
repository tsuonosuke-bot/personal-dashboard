import { validateAccess, type AccessEnv } from "./_shared/accessAuth.ts";
import { acceptHandoff, attachSession, hasValidSession, type SessionEnv } from "./_shared/sessionAuth.ts";

/**
 * Cloudflare Pages Functions のミドルウェア。
 * 全リクエストに HTTP Basic 認証をかける（静的アセットも含む）。
 *
 * 環境変数:
 *   DASHBOARD_PASSWORD  必須。未設定なら 503 を返してサイトを出さない（フェイルクローズ）。
 *   DASHBOARD_USER      任意。既定は "admin"。
 *
 * パスワードは ASCII で設定すること。Basic 認証のデコードに atob を使うため、
 * 非ASCII文字だと正しく比較できない。
 */

interface Env extends AccessEnv, SessionEnv {
  DASHBOARD_PASSWORD?: string;
  DASHBOARD_USER?: string;
  HUB_SERVICE_TOKEN?: string;
}

interface MiddlewareContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const REALM = 'Basic realm="knowledge-dashboard", charset="UTF-8"';

function withPrivacyHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "private, no-store");
  secured.headers.set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("Vary", "Authorization, Cf-Access-Jwt-Assertion, Cookie");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("X-Robots-Tag", "noindex, nofollow");
  return secured;
}

function unauthorized(): Response {
  return withPrivacyHeaders(new Response("認証が必要です。\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Content-Type": "text/plain; charset=utf-8",
    },
  }));
}

/** 長さの違いは漏れるが、内容の比較は定数時間で行う。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const onRequest = async (context: MiddlewareContext): Promise<Response> => {
  const { request, env, next } = context;
  const authMode = env.AUTH_MODE?.trim().toLowerCase() || "basic";
  if (authMode === "access") {
    const access = await validateAccess(request, env);
    if (!access.ok) {
      return withPrivacyHeaders(new Response(access.message, {
        status: access.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }));
    }
    return withPrivacyHeaders(await next());
  }
  if (authMode !== "basic") {
    return withPrivacyHeaders(new Response("AUTH_MODE is invalid.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
  }
  const handoff = await acceptHandoff(request, env);
  if (handoff) return withPrivacyHeaders(handoff);
  if (await hasValidSession(request, env)) {
    return withPrivacyHeaders(await next());
  }
  const requestUrl = new URL(request.url);
  const hubToken = request.headers.get("X-Hub-Service") || "";
  const expectedHubToken = env.HUB_SERVICE_TOKEN?.trim() || "";
  if (request.method === "GET"
    && (requestUrl.pathname === "/api/knowledge" || requestUrl.pathname === "/api/review/queue"
      || requestUrl.pathname === "/api/export" || requestUrl.pathname === "/api/status")
    && expectedHubToken.length >= 32 && safeEqual(hubToken, expectedHubToken)) {
    return withPrivacyHeaders(await next());
  }
  const expectedPassword = env.DASHBOARD_PASSWORD;

  if (!expectedPassword) {
    return withPrivacyHeaders(new Response(
      "DASHBOARD_PASSWORD が未設定です。Cloudflare Pages の環境変数に設定してください。\n",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    ));
  }

  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorized();

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const expectedUser = env.DASHBOARD_USER || "admin";

  // 短絡評価を避け、両方を必ず比較する。
  const userOk = safeEqual(user, expectedUser);
  const passwordOk = safeEqual(password, expectedPassword);
  if (!userOk || !passwordOk) return unauthorized();

  return withPrivacyHeaders(await attachSession(await next(), request, env));
};
