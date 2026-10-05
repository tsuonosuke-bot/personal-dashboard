import { createAuthMiddleware, isHubServiceRequest, type AuthEnv } from '@personal-dashboards/auth'
import { acceptHandoff, type SessionEnv } from './_shared/sessionAuth.ts'

// 認証の本体は packages/dashboard-auth。ここにはFinance固有の設定だけを置く。
interface Env extends AuthEnv, SessionEnv {}

// Hubが読むのは家計簿一覧・書き出し・接続状態のGETだけ。
const HUB_PATHS = ['/api/expenses', '/api/export', '/api/status'] as const

export const onRequest = createAuthMiddleware<Env>({
  realm: 'financial-dashboard',
  headers: {
    csp: "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
  messages: {
    unauthorized: '認証が必要です。\n',
    passwordMissing: 'DASHBOARD_PASSWORDが未設定です。Cloudflare Pagesの環境変数に設定してください。\n',
  },
  acceptHandoff,
  alternativeCredential: (request, env) => isHubServiceRequest(request, env, HUB_PATHS),
})
