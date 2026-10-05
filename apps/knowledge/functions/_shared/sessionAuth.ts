import {
  acceptHandoff as acceptSharedHandoff,
  createNonceConsumer,
  type SessionEnv as SharedSessionEnv,
} from "@personal-dashboards/auth";
import { isUuid } from "./knowledgeValidation.ts";
import type { SupabaseEnv } from "./supabaseRest.ts";

// トークン・Cookie・セッションの共通部分は packages/dashboard-auth にある。ここには
// Knowledge固有の部分（引き継ぎ後の遷移先と、nonceを消費するDB関数）だけを置く。
export { attachSession, createHandoffUrl, hasValidSession } from "@personal-dashboards/auth";

export interface SessionEnv extends SupabaseEnv, SharedSessionEnv {}

export function acceptedDestination(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/";
  let destination: URL;
  try {
    destination = new URL(value, "https://knowledge.invalid");
  } catch {
    return "/";
  }
  if (destination.origin !== "https://knowledge.invalid" || destination.pathname !== "/" || destination.hash) return "/";
  const entries = [...destination.searchParams.entries()];
  if (entries.length === 1 && destination.searchParams.get("view") === "quiz") return "/?view=quiz";
  if (
    entries.length === 2
    && destination.searchParams.getAll("view").length === 1
    && destination.searchParams.getAll("mode").length === 1
    && destination.searchParams.get("view") === "quiz"
    && destination.searchParams.get("mode") === "daily"
  ) return "/?view=quiz&mode=daily";
  const knowledgeId = destination.searchParams.get("knowledge");
  if (entries.length === 1 && knowledgeId && isUuid(knowledgeId)) {
    return `/?knowledge=${encodeURIComponent(knowledgeId)}`;
  }
  return "/";
}

export function acceptHandoff(request: Request, env: SessionEnv): Promise<Response | null> {
  return acceptSharedHandoff(request, env, {
    consumeNonce: createNonceConsumer(env),
    resolveDestination: acceptedDestination,
  });
}
