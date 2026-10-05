import {
  createAuthMiddleware,
  isHubServiceRequest,
  type AuthEnv,
} from "@personal-dashboards/auth";
import { hasReviewBatchToken, type ReviewBatchEnv } from "./_shared/reviewQueue.ts";
import { acceptHandoff, type SessionEnv } from "./_shared/sessionAuth.ts";

/**
 * Cloudflare Pages Functions のミドルウェア。全リクエストに認証をかける（静的アセットも含む）。
 * 認証の本体は packages/dashboard-auth。ここにはKnowledge固有の設定だけを置く。
 *
 * 環境変数:
 *   DASHBOARD_PASSWORD  必須。未設定なら 503 を返してサイトを出さない（フェイルクローズ）。
 *   DASHBOARD_USER      任意。既定は "admin"。
 */

interface Env extends AuthEnv, SessionEnv, ReviewBatchEnv {}

// Hubが読むのは一覧・復習キューの件数・書き出し・接続状態のGETだけ。
const HUB_PATHS = ["/api/knowledge", "/api/review-queue/status", "/api/export", "/api/status"] as const;

export const onRequest = createAuthMiddleware<Env>({
  realm: "knowledge-dashboard",
  headers: {
    csp: "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
  messages: {
    unauthorized: "認証が必要です。\n",
    passwordMissing: "DASHBOARD_PASSWORD が未設定です。Cloudflare Pages の環境変数に設定してください。\n",
  },
  acceptHandoff,
  // 定期実行（pg_cron）からの生成・採点バッチは専用の合言葉、Hubはサービストークンで読み取りだけ。
  alternativeCredential: (request, env) => hasReviewBatchToken(request, env) || isHubServiceRequest(request, env, HUB_PATHS),
});
