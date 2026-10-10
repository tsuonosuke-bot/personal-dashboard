import { fetchSupabase, jsonResponse, type SupabaseEnv } from "./supabase.ts";

/**
 * SSOの引き継ぎトークンとセッションCookie。トークン形式とCookie名は3アプリで同じでなければならない
 * （Hubが発行した引き継ぎトークンを、遷移先のアプリが検証する）。
 */
export interface SessionEnv {
  SSO_SHARED_SECRET?: string;
  SESSION_TTL_DAYS?: string;
}

type TokenType = "handoff" | "session";
type TokenPayload = { v: 1; typ: TokenType; aud: string; exp: number; nonce: string };

const COOKIE_NAME = "personal_hub_session";
const HANDOFF_TTL_SECONDS = 60;
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
  } catch { return null; }
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
): Promise<TokenPayload | null> {
  const [encoded, encodedSignature, extra] = token.split(".");
  if (!encoded || !encodedSignature || extra) return null;
  const payloadBytes = fromBase64Url(encoded);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(value), signature as unknown as BufferSource, encoder.encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<TokenPayload>;
    return payload.v === 1 && payload.typ === type && payload.aud === audience
      && typeof payload.exp === "number" && Number.isInteger(payload.exp)
      && payload.exp >= Math.floor(now / 1_000) - 5
      && typeof payload.nonce === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(payload.nonce)
      ? payload as TokenPayload
      : null;
  } catch { return null; }
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
  return Boolean(await verifyToken(token, "session", new URL(request.url).host, value));
}

export async function attachSession(response: Response, request: Request, env: SessionEnv): Promise<Response> {
  const value = secret(env);
  if (!value) return response;
  const days = sessionDays(env);
  const payload: TokenPayload = {
    v: 1,
    typ: "session",
    aud: new URL(request.url).host,
    exp: Math.floor(Date.now() / 1_000) + days * 86400,
    nonce: nonce(),
  };
  const token = await signPayload(payload, value);
  const secured = new Response(response.body, response);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  secured.headers.append("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; Max-Age=${days * 86400}; HttpOnly${secure}; SameSite=Lax`);
  return secured;
}

const PROXY_SESSION_TTL_SECONDS = 300;

/**
 * Hubのプロキシ（/knowledge/・/finance/）が、上流アプリへの1回のリクエストに付けるセッションCookie。
 * 引き継ぎ（/auth/handoff）と同じ共有シークレットで署名するので、上流は通常のセッションとして検証する。
 * サーバー間でだけ使い、ブラウザへは渡さない。引き継ぎの往復とnonce消費を毎回しないためのもの。
 */
export async function createProxySessionCookie(target: URL, env: SessionEnv): Promise<string | null> {
  const value = secret(env);
  if (!value) return null;
  const payload: TokenPayload = {
    v: 1,
    typ: "session",
    aud: target.host,
    exp: Math.floor(Date.now() / 1_000) + PROXY_SESSION_TTL_SECONDS,
    nonce: nonce(),
  };
  return `${COOKIE_NAME}=${await signPayload(payload, value)}`;
}

/** Hubが、遷移先アプリの `/auth/handoff` へ渡す60秒有効の引き継ぎURLを作る。 */
export async function createHandoffUrl(target: URL, env: SessionEnv): Promise<URL | null> {
  const value = secret(env);
  if (!value) return null;
  const payload: TokenPayload = {
    v: 1,
    typ: "handoff",
    aud: target.host,
    exp: Math.floor(Date.now() / 1_000) + HANDOFF_TTL_SECONDS,
    nonce: nonce(),
  };
  const token = await signPayload(payload, value);
  const redirect = new URL("/auth/handoff", target.origin);
  redirect.searchParams.set("token", token);
  const destination = `${target.pathname}${target.search}${target.hash}`;
  if (destination !== "/") redirect.searchParams.set("next", destination);
  return redirect;
}

/**
 * 引き継ぎトークンを1回だけ受理するための消費関数。true=初めて使った、false=使用済み、
 * Response=DBの失敗（そのまま返す）。
 */
export type NonceConsumer = (payload: { nonce: string; exp: number }) => Promise<boolean | Response>;

export interface HandoffOptions {
  /**
   * 引き継ぎトークンの再利用を防ぐ。トークンの有効期間（60秒）のあいだ同じトークンを
   * もう一度使えてしまうため、引き継ぎを受け付けるアプリは必ず渡す。
   * nullを渡せるのは、実際には引き継ぎを受けないアプリ（発行側のHub）だけ。
   */
  consumeNonce: NonceConsumer | null;
  /** `next` パラメータから遷移先を決める。省略すると常に "/"。 */
  resolveDestination?: (next: string | null) => string;
}

/** `consume_dashboard_handoff_nonce` をSupabaseのRPCで呼ぶ消費関数。 */
export function createNonceConsumer(env: SupabaseEnv, rpcName = "consume_dashboard_handoff_nonce"): NonceConsumer {
  return async ({ nonce: value, exp }) => {
    const rawUrl = env.SUPABASE_URL?.trim();
    const secretKey = env.SUPABASE_SECRET_KEY?.trim();
    if (!rawUrl || !secretKey) return jsonResponse({ error: "サーバーのDB接続設定が未完了です。" }, 503);
    let endpoint: URL;
    try {
      endpoint = new URL(`/rest/v1/rpc/${rpcName}`, rawUrl);
    } catch {
      return jsonResponse({ error: "サーバーのDB接続先が正しくありません。" }, 503);
    }
    if (endpoint.protocol !== "https:") {
      return jsonResponse({ error: "サーバーのDB接続先はHTTPSである必要があります。" }, 503);
    }
    try {
      const response = await fetchSupabase(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", apikey: secretKey },
        body: JSON.stringify({ p_nonce: value, p_expires_at: exp }),
      });
      if (!response.ok) {
        console.error(`Supabase rpc ${rpcName} request failed with status ${response.status}`);
        return jsonResponse({ error: "DBの処理に失敗しました。" }, 502);
      }
      return (await response.json()) === true;
    } catch (error) {
      console.error(`Supabase rpc ${rpcName} request failed`, error instanceof Error ? error.message : "unknown error");
      return jsonResponse({ error: "DBへの接続中にエラーが発生しました。" }, 502);
    }
  };
}

/** `/auth/handoff` なら引き継ぎを処理して応答を返す。それ以外はnull。 */
export async function acceptHandoff(request: Request, env: SessionEnv, options: HandoffOptions): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/auth/handoff") return null;
  const value = secret(env);
  if (!value) return new Response("SSO handoff is not configured.\n", { status: 503 });
  const token = url.searchParams.get("token") || "";
  const payload = await verifyToken(token, "handoff", url.host, value);
  if (!payload) return new Response("SSO handoff token is invalid.\n", { status: 403 });
  if (options.consumeNonce) {
    const consumed = await options.consumeNonce({ nonce: payload.nonce, exp: payload.exp });
    if (consumed instanceof Response) return consumed;
    if (!consumed) return new Response("SSO handoff token has already been used.\n", { status: 403 });
  }
  const destination = options.resolveDestination ? options.resolveDestination(url.searchParams.get("next")) : "/";
  return attachSession(new Response(null, { status: 302, headers: { Location: destination } }), request, env);
}
