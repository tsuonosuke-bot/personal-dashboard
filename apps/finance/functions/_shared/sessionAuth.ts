import {
  acceptHandoff as acceptSharedHandoff,
  createNonceConsumer,
  type SessionEnv as SharedSessionEnv,
} from '@personal-dashboards/auth'
import type { SupabaseEnv } from './supabaseRest.ts'

// トークン・Cookie・セッションの共通部分は packages/dashboard-auth にある。
export { attachSession, hasValidSession } from '@personal-dashboards/auth'

export interface SessionEnv extends SupabaseEnv, SharedSessionEnv {}

/** 引き継ぎトークンは1回しか使えない（nonceをDBで消費する。Knowledgeと同じ関数）。 */
export function acceptHandoff(request: Request, env: SessionEnv): Promise<Response | null> {
  return acceptSharedHandoff(request, env, { consumeNonce: createNonceConsumer(env) })
}
