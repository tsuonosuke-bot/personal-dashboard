import { validateAccess, type AccessEnv } from "./accessAuth.ts";
import { attachSession, hasValidSession, type SessionEnv } from "./session.ts";

export interface AuthEnv extends AccessEnv, SessionEnv {
  DASHBOARD_PASSWORD?: string;
  DASHBOARD_USER?: string;
  HUB_SERVICE_TOKEN?: string;
}

export interface MiddlewareContext<Env extends AuthEnv> {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

/** 長さの違いは漏れるが、内容の比較は定数時間で行う。 */
export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * HubのサービストークンでのGET。許可したパスだけを、32文字以上のトークンと一致したときに通す。
 * Hubが読むのは一覧・件数・書き出し・接続状態の読み取りだけにする。
 */
export function isHubServiceRequest(request: Request, env: AuthEnv, allowedPaths: readonly string[]): boolean {
  if (request.method !== "GET") return false;
  if (!allowedPaths.includes(new URL(request.url).pathname)) return false;
  const expected = env.HUB_SERVICE_TOKEN?.trim() || "";
  return expected.length >= 32 && safeEqual(request.headers.get("X-Hub-Service") || "", expected);
}

export interface HeaderPolicy {
  /** Content-Security-Policy。アプリのビルド（インラインstyleの有無など）に合わせて渡す。 */
  csp: string;
  permissionsPolicy?: string;
}

/** 公開・非公開どちらのレスポンスにも付けるヘッダー。 */
export function applySecurityHeaders(response: Response, policy: HeaderPolicy): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", policy.csp);
  if (policy.permissionsPolicy) secured.headers.set("Permissions-Policy", policy.permissionsPolicy);
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  return secured;
}

/** 認証の内側のレスポンスに付けるヘッダー（キャッシュ・検索エンジンに載せない）。 */
export function applyPrivacyHeaders(response: Response, policy: HeaderPolicy): Response {
  const secured = applySecurityHeaders(response, policy);
  secured.headers.set("Cache-Control", "private, no-store");
  secured.headers.set("Vary", "Authorization, Cf-Access-Jwt-Assertion, Cookie");
  secured.headers.set("X-Robots-Tag", "noindex, nofollow");
  return secured;
}

// Viteが出力する、内容のハッシュを名前に含むファイル（/assets/name-XXXXXXXX.js など）。
// 中身が変われば名前も変わるので、ログインした本人のブラウザには長く保存させてよい。
const HASHED_ASSET = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|png|jpe?g|svg|webp)$/;

/** 認証の内側の応答のうち、ハッシュ付きの静的ファイルだけをブラウザに保存させる。 */
export function applyAssetCache(request: Request, response: Response): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (response.status !== 200 || !HASHED_ASSET.test(new URL(request.url).pathname)) return response;
  response.headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return response;
}

/** 認証なしで公開するページ向け。検索エンジンに載せ、5分キャッシュさせる。 */
export function applyPublicCache(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "public, max-age=300");
  secured.headers.set("X-Robots-Tag", "index, follow");
  return secured;
}

export interface AuthMiddlewareOptions<Env extends AuthEnv> {
  /** `Basic realm="..."` の中身。 */
  realm: string;
  headers: HeaderPolicy;
  /** `/auth/handoff` の処理。nonceの消費と遷移先はアプリごとに決める（session.tsの acceptHandoff を束ねる）。 */
  acceptHandoff: (request: Request, env: Env) => Promise<Response | null>;
  messages: {
    /** 401の本文。 */
    unauthorized: string;
    /** DASHBOARD_PASSWORD未設定の503の本文。 */
    passwordMissing: string;
  };
  /** 認証なしで返す公開ページ。応答を返すとそこで終わり、nullなら通常の認証へ進む。 */
  publicRoute?: (
    context: MiddlewareContext<Env>,
    headers: { security: (response: Response) => Response },
  ) => Promise<Response | null>;
  /** セッションの次に確かめる、パスワード以外の資格（定期実行の合言葉、Hubのサービストークン）。 */
  alternativeCredential?: (request: Request, env: Env) => boolean;
}

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };

/**
 * Pages Functionsの `_middleware.ts` の共通部分。全リクエスト（静的アセットも含む）を、
 * Cloudflare Access、または SSO引き継ぎ・セッション・HTTP Basic認証で守る。
 * DASHBOARD_PASSWORD が無ければ503を返してサイトを出さない（フェイルクローズ）。
 * パスワードはASCIIで設定すること（Basic認証のデコードに atob を使う）。
 */
export function createAuthMiddleware<Env extends AuthEnv>(options: AuthMiddlewareOptions<Env>) {
  const privacy = (response: Response) => applyPrivacyHeaders(response, options.headers);
  const unauthorized = () => privacy(new Response(options.messages.unauthorized, {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${options.realm}", charset="UTF-8"`, ...TEXT },
  }));

  return async (context: MiddlewareContext<Env>): Promise<Response> => {
    const { request, env, next } = context;
    if (options.publicRoute) {
      const response = await options.publicRoute(context, { security: (value) => applySecurityHeaders(value, options.headers) });
      if (response) return response;
    }

    const authMode = env.AUTH_MODE?.trim().toLowerCase() || "basic";
    if (authMode === "access") {
      const access = await validateAccess(request, env);
      if (!access.ok) return privacy(new Response(access.message, { status: access.status, headers: TEXT }));
      return applyAssetCache(request, privacy(await next()));
    }
    if (authMode !== "basic") {
      return privacy(new Response("AUTH_MODE is invalid.\n", { status: 503, headers: TEXT }));
    }

    const handoff = await options.acceptHandoff(request, env);
    if (handoff) return privacy(handoff);
    if (await hasValidSession(request, env)) return applyAssetCache(request, privacy(await next()));
    if (options.alternativeCredential?.(request, env)) return privacy(await next());

    const expectedPassword = env.DASHBOARD_PASSWORD;
    if (!expectedPassword) {
      return privacy(new Response(options.messages.passwordMissing, { status: 503, headers: TEXT }));
    }

    const header = request.headers.get("Authorization");
    if (!header?.startsWith("Basic ")) return unauthorized();
    let decoded: string;
    try {
      decoded = atob(header.slice("Basic ".length));
    } catch {
      return unauthorized();
    }
    const separator = decoded.indexOf(":");
    if (separator < 0) return unauthorized();

    // 短絡評価を避け、両方を必ず比較する。
    const userOk = safeEqual(decoded.slice(0, separator), env.DASHBOARD_USER || "admin");
    const passwordOk = safeEqual(decoded.slice(separator + 1), expectedPassword);
    if (!userOk || !passwordOk) return unauthorized();

    return applyAssetCache(request, privacy(await attachSession(await next(), request, env)));
  };
}
