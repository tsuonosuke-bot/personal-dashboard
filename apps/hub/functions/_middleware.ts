import {
  applyPublicCache,
  createAuthMiddleware,
  isHubServiceRequest,
  type AuthEnv,
  type HeaderPolicy,
} from "@personal-dashboards/auth";
import { acceptHandoff, type SessionEnv } from "./_shared/sessionAuth.ts";
import { hasCalendarSyncCredential, type CalendarSyncEnv } from "./_shared/calendarSync.ts";
import { hasReviewBatchToken, type ReviewBatchEnv } from "./knowledge/_shared/reviewQueue.ts";

// 認証の本体は packages/dashboard-auth。Hub・Knowledge・Financeは1つのPagesプロジェクトで、この1本が全体を守る。
interface Env extends AuthEnv, SessionEnv, CalendarSyncEnv, ReviewBatchEnv {}

// 旧Hubが読んでいた、Knowledge・Financeの読み取り専用GET。サービストークンで通す。
const HUB_SERVICE_PATHS = [
  "/knowledge/api/knowledge",
  "/knowledge/api/hub-summary",
  "/knowledge/api/review-queue/status",
  "/knowledge/api/export",
  "/knowledge/api/status",
  "/finance/api/expenses",
  "/finance/api/export",
  "/finance/api/status",
  "/finance/api/hub-summary",
] as const;

const HUB_POLICY: HeaderPolicy = {
  csp: "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  permissionsPolicy: "camera=(), microphone=(), geolocation=()",
};

// KnowledgeとFinanceのReactアプリはstyle属性を使う。Knowledgeの英会話練習はマイクを使うので、Permissions-Policyも付けない。
const APP_POLICY: HeaderPolicy = {
  csp: "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function isAppPath(pathname: string): boolean {
  return /^\/(knowledge|finance)(\/|$)/.test(pathname);
}

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
  headers: (request) => (isAppPath(new URL(request.url).pathname) ? APP_POLICY : HUB_POLICY),
  messages: {
    unauthorized: "Authentication required.\n",
    passwordMissing: "DASHBOARD_PASSWORD is not configured.\n",
  },
  acceptHandoff,
  // pg_cronの定期実行は、専用の合言葉でそのパスに限り通す（カレンダー同期、Knowledgeの生成・採点・embeddingバッチ）。
  alternativeCredential: (request, env) =>
    (request.method === "POST" && new URL(request.url).pathname === "/api/calendar-sync" && hasCalendarSyncCredential(request, env))
    || hasReviewBatchToken(request, env)
    || isHubServiceRequest(request, env, HUB_SERVICE_PATHS),
  // OAuthの同意画面が参照する静的ページだけは、認証なしで公開する。
  publicRoute: async ({ request, next }, headers) => {
    const { pathname } = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && PUBLIC_OAUTH_PATHS.has(pathname)) {
      return applyPublicCache(headers.security(await next()));
    }
    return null;
  },
});
