import { createHandoffUrl, type SessionEnv } from "./sessionAuth.ts";

export interface DashboardProxyEnv extends SessionEnv {
  NAV_FINANCIAL_URL?: string;
  NAV_KNOWLEDGE_URL?: string;
}

interface ProxyContext {
  request: Request;
  env: DashboardProxyEnv;
}

type DashboardTarget = "finance" | "knowledge";

const TARGETS: Record<DashboardTarget, { env: keyof DashboardProxyEnv; fallback: string }> = {
  finance: { env: "NAV_FINANCIAL_URL", fallback: "https://financial-dashboard-9q8.pages.dev/" },
  knowledge: { env: "NAV_KNOWLEDGE_URL", fallback: "https://knowledge-dashboard-27t.pages.dev/" },
};

function upstreamBase(target: DashboardTarget, env: DashboardProxyEnv): URL {
  const definition = TARGETS[target];
  const url = new URL(String(env[definition.env] || definition.fallback));
  if (url.protocol !== "https:") throw new Error("Dashboard proxy target must use HTTPS.");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function proxyPath(request: Request, target: DashboardTarget): string {
  const pathname = new URL(request.url).pathname;
  const prefix = `/${target}`;
  if (pathname === prefix || pathname === `${prefix}/`) return "/";
  if (!pathname.startsWith(`${prefix}/`)) throw new Error("Dashboard proxy path is invalid.");
  return pathname.slice(prefix.length);
}

function cookiePair(setCookie: string | null): string | null {
  const pair = setCookie?.split(";", 1)[0]?.trim() || "";
  return /^[^=;\s]+=[^;]*$/.test(pair) ? pair : null;
}

async function upstreamSession(base: URL, env: DashboardProxyEnv): Promise<string | null> {
  const handoff = await createHandoffUrl(base, env);
  if (!handoff) return null;
  const response = await fetch(handoff, { method: "GET", redirect: "manual" });
  if (response.status < 300 || response.status >= 400) return null;
  return cookiePair(response.headers.get("Set-Cookie"));
}

function requestHeaders(request: Request, sessionCookie: string | null, upstream: URL): Headers {
  const headers = new Headers(request.headers);
  for (const name of ["host", "cookie", "content-length", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor"]) {
    headers.delete(name);
  }
  if (sessionCookie) {
    headers.delete("authorization");
    headers.set("cookie", sessionCookie);
  }
  if (headers.has("origin")) headers.set("origin", upstream.origin);
  headers.set("x-forwarded-host", new URL(request.url).host);
  return headers;
}

function responseHeaders(response: Response, target: DashboardTarget, upstream: URL, request: Request): Headers {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.delete("content-length");
  const location = headers.get("location");
  if (location) {
    const redirected = new URL(location, upstream);
    if (redirected.origin === upstream.origin) {
      const local = new URL(request.url);
      local.pathname = `/${target}${redirected.pathname === "/" ? "/" : redirected.pathname}`;
      local.search = redirected.search;
      local.hash = redirected.hash;
      headers.set("location", local.toString());
    }
  }
  return headers;
}

export async function proxyDashboardRequest(context: ProxyContext, target: DashboardTarget): Promise<Response> {
  if (context.request.method === "CONNECT" || context.request.method === "TRACE") {
    return new Response("Method Not Allowed\n", { status: 405 });
  }

  let base: URL;
  let path: string;
  try {
    base = upstreamBase(target, context.env);
    path = proxyPath(context.request, target);
  } catch {
    return new Response("Dashboard proxy configuration is invalid.\n", { status: 503 });
  }

  const incoming = new URL(context.request.url);
  const upstream = new URL(path, base);
  upstream.search = incoming.search;
  const sessionCookie = await upstreamSession(base, context.env);
  const method = context.request.method;
  const response = await fetch(upstream, {
    method,
    headers: requestHeaders(context.request, sessionCookie, upstream),
    body: method === "GET" || method === "HEAD" ? undefined : context.request.body,
    redirect: "manual",
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response, target, upstream, context.request),
  });
}
