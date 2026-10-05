import { acceptHandoff as acceptSharedHandoff, type SessionEnv } from "@personal-dashboards/auth";

// トークン・Cookie・セッションの共通部分は packages/dashboard-auth にある。
export { attachSession, createHandoffUrl, hasValidSession, type SessionEnv } from "@personal-dashboards/auth";

/**
 * Hubは引き継ぎトークンの発行側で、他のアプリからは受け取らない。そのためnonceを消費しない
 * （消費するのは受け取る側のKnowledgeとFinance）。
 */
export function acceptHandoff(request: Request, env: SessionEnv): Promise<Response | null> {
  return acceptSharedHandoff(request, env, { consumeNonce: null });
}
