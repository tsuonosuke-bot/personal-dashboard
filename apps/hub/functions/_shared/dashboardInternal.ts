import { onRequest as knowledgeExport } from "../knowledge/api/export.ts";
import { onRequest as knowledgeHubSummary } from "../knowledge/api/hub-summary.ts";
import { onRequest as knowledgeStatus } from "../knowledge/api/status.ts";
import { onRequest as financeExport } from "../finance/api/export.ts";
import { onRequest as financeHubSummary } from "../finance/api/hub-summary.ts";
import { onRequest as financeStatus } from "../finance/api/status.ts";

export type DashboardApp = "knowledge" | "finance";

interface Handler {
  (context: { request: Request; env: never }): Promise<Response> | Response;
}

// HubがKnowledge・Financeから読む、読み取り専用のGETだけ。同じプロジェクトのハンドラを直接呼ぶ。
const HANDLERS: Record<string, Handler> = {
  "/knowledge/api/hub-summary": knowledgeHubSummary as Handler,
  "/knowledge/api/status": knowledgeStatus as Handler,
  "/knowledge/api/export": knowledgeExport as Handler,
  "/finance/api/hub-summary": financeHubSummary as Handler,
  "/finance/api/status": financeStatus as Handler,
  "/finance/api/export": financeExport as Handler,
};

/**
 * NAV_*_URL が有効なHTTPS（またはローカルのhttp）のURLなら、別のPagesプロジェクトへ向ける旧来の接続として返す。
 * 未設定・不正ならnullで、同じプロジェクト内のハンドラを呼ぶ。
 */
export function externalDashboardBase(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    return parsed.protocol === "https:" || local ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Hubの内部読み取り。外部のベースURLがあればHTTP、無ければ同一プロジェクトのハンドラを直接呼ぶ。
 * 直接呼ぶ場合、認証はHubの `_middleware.ts` が呼び出し元に対して済ませているので、サービストークンは使わない。
 */
export async function fetchDashboard(
  env: unknown,
  app: DashboardApp,
  external: string | null,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (external) return fetch(new URL(path, external), init);
  const url = new URL(`/${app}${path}`, "https://hub.internal");
  const handler = HANDLERS[url.pathname];
  if (!handler) return new Response("Not Found\n", { status: 404 });
  return handler({ request: new Request(url, { method: "GET", headers: init.headers, signal: init.signal }), env: env as never });
}
