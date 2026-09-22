import type { HubEnv } from "./hub.ts";

export interface ConnectionStatusEnv extends HubEnv {
  AUTH_MODE?: string;
}

export interface ServiceConnectionStatus {
  id: "personal" | "knowledge" | "finance";
  name: string;
  authMethod: string;
  destination: string;
  migration: string;
  lastSuccessAt: string | null;
}

const DEFAULT_FINANCIAL_URL = "https://financial-dashboard-9q8.pages.dev/";
const DEFAULT_KNOWLEDGE_URL = "https://knowledge-dashboard-27t.pages.dev/";

function authMethod(value: string | undefined): string {
  return value?.trim().toLowerCase() === "access"
    ? "Cloudflare Access"
    : "Basic認証 + 署名付きセッション";
}

function safeHost(value: string | undefined, fallback: string): string {
  try {
    const url = new URL(value?.trim() || fallback);
    return url.host;
  } catch {
    return "確認できません";
  }
}

function fallbackStatus(
  id: ServiceConnectionStatus["id"],
  name: string,
  destination: string,
): ServiceConnectionStatus {
  return {
    id,
    name,
    authMethod: "確認できません",
    destination,
    migration: "確認できません",
    lastSuccessAt: null,
  };
}

async function localStatus(env: ConnectionStatusEnv): Promise<ServiceConnectionStatus> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new Error("Personal DB is not configured.");
  const endpoint = new URL("/rest/v1/dashboard_schema_versions", rawUrl);
  endpoint.searchParams.set("select", "migration");
  endpoint.searchParams.set("app_id", "eq.personal-dashboard");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, { headers: { Accept: "application/json", apikey: key } });
  if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("json")) {
    throw new Error("Personal DB status request failed.");
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || typeof rows[0]?.migration !== "string") {
    throw new Error("Personal DB migration status is unavailable.");
  }
  const migration = rows[0].migration;
  return {
    id: "personal",
    name: "Personal",
    authMethod: authMethod(env.AUTH_MODE),
    destination: safeHost(rawUrl, "https://invalid.example"),
    migration,
    lastSuccessAt: new Date().toISOString(),
  };
}

async function remoteStatus(
  env: ConnectionStatusEnv,
  id: "knowledge" | "finance",
  name: string,
  baseUrl: string,
): Promise<ServiceConnectionStatus> {
  const token = env.HUB_SERVICE_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error(`${name} service token is not configured.`);
  const endpoint = new URL("/api/status", baseUrl);
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "X-Hub-Service": token },
  });
  if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("json")) {
    throw new Error(`${name} status request failed.`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) throw new Error(`${name} status response is invalid.`);
  const value = body as Record<string, unknown>;
  if (typeof value.authMethod !== "string" || typeof value.destination !== "string"
    || typeof value.migration !== "string" || typeof value.lastSuccessAt !== "string") {
    throw new Error(`${name} status response is invalid.`);
  }
  return { id, name, authMethod: value.authMethod, destination: value.destination, migration: value.migration, lastSuccessAt: value.lastSuccessAt };
}

export async function loadConnectionStatus(env: ConnectionStatusEnv) {
  const financialUrl = env.NAV_FINANCIAL_URL?.trim() || DEFAULT_FINANCIAL_URL;
  const knowledgeUrl = env.NAV_KNOWLEDGE_URL?.trim() || DEFAULT_KNOWLEDGE_URL;
  const results = await Promise.allSettled([
    localStatus(env),
    remoteStatus(env, "knowledge", "Knowledge", knowledgeUrl),
    remoteStatus(env, "finance", "Finance", financialUrl),
  ] as const);
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error(`connection status ${index} failed`);
  });
  return {
    services: [
      results[0].status === "fulfilled" ? results[0].value : fallbackStatus("personal", "Personal", safeHost(env.SUPABASE_URL, "https://invalid.example")),
      results[1].status === "fulfilled" ? results[1].value : fallbackStatus("knowledge", "Knowledge", safeHost(knowledgeUrl, DEFAULT_KNOWLEDGE_URL)),
      results[2].status === "fulfilled" ? results[2].value : fallbackStatus("finance", "Finance", safeHost(financialUrl, DEFAULT_FINANCIAL_URL)),
    ],
  };
}
