import { applyPublicCache, createAuthMiddleware, type AuthEnv } from "@personal-dashboards/auth";
import { acceptHandoff, type SessionEnv } from "./_shared/sessionAuth.ts";
import { hasCalendarSyncCredential, type CalendarSyncEnv } from "./_shared/calendarSync.ts";

// 認証の本体は packages/dashboard-auth。ここにはHub固有の設定だけを置く。
interface Env extends AuthEnv, SessionEnv, CalendarSyncEnv {}

const PUBLIC_OAUTH_PATHS = new Set([
  "/oauth",
  "/oauth/",
  "/oauth/privacy",
  "/oauth/privacy/",
  "/oauth/terms",
  "/oauth/terms/",
  "/oauth.css",
]);

export const onRequest = createAuthMiddleware<Env>({
  realm: "compass-dashboard",
  headers: {
    csp: "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    permissionsPolicy: "camera=(), microphone=(), geolocation=()",
  },
  messages: {
    unauthorized: "Authentication required.\n",
    passwordMissing: "DASHBOARD_PASSWORD is not configured.\n",
  },
  acceptHandoff,
  // pg_cronの15分おき同期だけは、専用のBearerでこの1本のパスに限り通す。
  alternativeCredential: (request, env) =>
    request.method === "POST" && new URL(request.url).pathname === "/api/calendar-sync" && hasCalendarSyncCredential(request, env),
  // OAuthの同意画面が参照する静的ページだけは、認証なしで公開する。
  publicRoute: async ({ request, next }, headers) => {
    const { pathname } = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && PUBLIC_OAUTH_PATHS.has(pathname)) {
      return applyPublicCache(headers.security(await next()));
    }
    return null;
  },
});
