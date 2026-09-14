import { validateAccess, type AccessEnv } from "./_shared/accessAuth.ts";
import { acceptHandoff, attachSession, hasValidSession, type SessionEnv } from "./_shared/sessionAuth.ts";

interface Env extends AccessEnv, SessionEnv {
  DASHBOARD_PASSWORD?: string;
  DASHBOARD_USER?: string;
}

interface MiddlewareContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const REALM = 'Basic realm="compass-dashboard", charset="UTF-8"';

function withPrivacyHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "private, no-store");
  secured.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("Vary", "Authorization, Cf-Access-Jwt-Assertion, Cookie");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("X-Robots-Tag", "noindex, nofollow");
  return secured;
}

function unauthorized(): Response {
  return withPrivacyHeaders(new Response("Authentication required.\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Content-Type": "text/plain; charset=utf-8",
    },
  }));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export const onRequest = async (context: MiddlewareContext): Promise<Response> => {
  const authMode = context.env.AUTH_MODE?.trim().toLowerCase() || "basic";
  if (authMode === "access") {
    const access = await validateAccess(context.request, context.env);
    if (!access.ok) {
      return withPrivacyHeaders(new Response(access.message, {
        status: access.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }));
    }
    return withPrivacyHeaders(await context.next());
  }
  if (authMode !== "basic") {
    return withPrivacyHeaders(new Response("AUTH_MODE is invalid.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
  }

  const handoff = await acceptHandoff(context.request, context.env);
  if (handoff) return withPrivacyHeaders(handoff);
  if (await hasValidSession(context.request, context.env)) {
    return withPrivacyHeaders(await context.next());
  }

  const expectedPassword = context.env.DASHBOARD_PASSWORD;
  if (!expectedPassword) {
    return withPrivacyHeaders(new Response(
      "DASHBOARD_PASSWORD is not configured.\n",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    ));
  }

  const authorization = context.request.headers.get("Authorization");
  if (!authorization?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(authorization.slice("Basic ".length));
  } catch {
    return unauthorized();
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorized();

  const suppliedUser = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);
  const expectedUser = context.env.DASHBOARD_USER || "admin";
  const userMatches = safeEqual(suppliedUser, expectedUser);
  const passwordMatches = safeEqual(suppliedPassword, expectedPassword);
  if (!userMatches || !passwordMatches) return unauthorized();

  return withPrivacyHeaders(await attachSession(await context.next(), context.request, context.env));
};
