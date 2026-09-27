export interface SessionEnv {
  SSO_SHARED_SECRET?: string;
  SESSION_TTL_DAYS?: string;
}

type TokenType = "handoff" | "session";
interface TokenPayload {
  v: 1;
  typ: TokenType;
  aud: string;
  exp: number;
  nonce: string;
}

const COOKIE_NAME = "personal_hub_session";
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function secret(env: SessionEnv): string | null {
  const value = env.SSO_SHARED_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

async function hmacKey(value: string) {
  return crypto.subtle.importKey("raw", encoder.encode(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signPayload(payload: TokenPayload, value: string): Promise<string> {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(value), encoder.encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyToken(
  token: string,
  type: TokenType,
  audience: string,
  value: string,
  now = Date.now(),
): Promise<boolean> {
  const [encoded, encodedSignature, extra] = token.split(".");
  if (!encoded || !encodedSignature || extra) return false;
  const payloadBytes = fromBase64Url(encoded);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return false;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(value), signature as unknown as BufferSource, encoder.encode(encoded));
  if (!valid) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<TokenPayload>;
    return payload.v === 1
      && payload.typ === type
      && payload.aud === audience
      && typeof payload.exp === "number"
      && payload.exp >= Math.floor(now / 1_000) - 5;
  } catch {
    return false;
  }
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function readCookie(request: Request): string | null {
  const cookies = request.headers.get("Cookie") || "";
  for (const entry of cookies.split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name === COOKIE_NAME) return parts.join("=") || null;
  }
  return null;
}

function sessionDays(env: SessionEnv): number {
  const parsed = Number(env.SESSION_TTL_DAYS || "30");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : 30;
}

export async function hasValidSession(request: Request, env: SessionEnv): Promise<boolean> {
  const value = secret(env);
  const token = readCookie(request);
  if (!value || !token) return false;
  return verifyToken(token, "session", new URL(request.url).host, value);
}

export async function attachSession(response: Response, request: Request, env: SessionEnv): Promise<Response> {
  const value = secret(env);
  if (!value) return response;
  const days = sessionDays(env);
  const payload: TokenPayload = {
    v: 1,
    typ: "session",
    aud: new URL(request.url).host,
    exp: Math.floor(Date.now() / 1_000) + days * 24 * 60 * 60,
    nonce: nonce(),
  };
  const token = await signPayload(payload, value);
  const secured = new Response(response.body, response);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  secured.headers.append("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; Max-Age=${days * 86400}; HttpOnly${secure}; SameSite=Lax`);
  return secured;
}

export async function createHandoffUrl(target: URL, env: SessionEnv): Promise<URL | null> {
  const value = secret(env);
  if (!value) return null;
  const payload: TokenPayload = {
    v: 1,
    typ: "handoff",
    aud: target.host,
    exp: Math.floor(Date.now() / 1_000) + 60,
    nonce: nonce(),
  };
  const token = await signPayload(payload, value);
  const redirect = new URL("/auth/handoff", target.origin);
  redirect.searchParams.set("token", token);
  const destination = `${target.pathname}${target.search}${target.hash}`;
  if (destination !== "/") redirect.searchParams.set("next", destination);
  return redirect;
}

export async function acceptHandoff(request: Request, env: SessionEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/auth/handoff") return null;
  const value = secret(env);
  if (!value) return new Response("SSO handoff is not configured.\n", { status: 503 });
  const token = url.searchParams.get("token") || "";
  if (!await verifyToken(token, "handoff", url.host, value)) {
    return new Response("SSO handoff token is invalid.\n", { status: 403 });
  }
  return attachSession(new Response(null, { status: 302, headers: { Location: "/" } }), request, env);
}
