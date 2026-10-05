import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptHandoff,
  createAuthMiddleware,
  createHandoffUrl,
  isHubServiceRequest,
  safeEqual,
  type AuthEnv,
} from "../src/index.ts";

const SHARED = "shared-secret-that-is-longer-than-thirty-two-characters";
const HUB_TOKEN = "hub-service-token-that-is-at-least-32-characters";

const onRequest = createAuthMiddleware<AuthEnv>({
  realm: "test-dashboard",
  headers: { csp: "default-src 'self'", permissionsPolicy: "camera=()" },
  messages: { unauthorized: "unauthorized\n", passwordMissing: "password missing\n" },
  acceptHandoff: (request, env) => acceptHandoff(request, env, { consumeNonce: async () => true }),
  alternativeCredential: (request, env) => isHubServiceRequest(request, env, ["/api/items"]) || request.headers.get("X-Batch") === "ok",
  publicRoute: async ({ request, next }, headers) =>
    new URL(request.url).pathname === "/public" ? headers.security(await next()) : null,
});

const call = (request: Request, env: AuthEnv, body = "secret") => onRequest({ request, env, next: async () => new Response(body) });
const get = (path: string, headers?: Record<string, string>) => new Request(`https://dashboard.example${path}`, { headers });
const basic = (user: string, password: string) => ({ Authorization: `Basic ${btoa(`${user}:${password}`)}` });

test("DASHBOARD_PASSWORD が無ければフェイルクローズし、アプリの本文を出さない", async () => {
  const response = await call(get("/"), {});
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "password missing\n");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("Basic認証を検証し、プライバシー・セキュリティヘッダーを全レスポンスへ付ける", async () => {
  const env = { DASHBOARD_USER: "owner", DASHBOARD_PASSWORD: "long-password" };
  const none = await call(get("/"), env);
  assert.equal(none.status, 401);
  assert.equal(none.headers.get("WWW-Authenticate"), 'Basic realm="test-dashboard", charset="UTF-8"');
  assert.equal(await none.text(), "unauthorized\n");

  for (const credentials of [basic("owner", "wrong"), basic("other", "long-password"), { Authorization: "Basic !!!" }, { Authorization: `Basic ${btoa("nocolon")}` }]) {
    assert.equal((await call(get("/", credentials), env)).status, 401);
  }

  const ok = await call(get("/", basic("owner", "long-password")), env);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");
  assert.equal(ok.headers.get("Content-Security-Policy"), "default-src 'self'");
  assert.equal(ok.headers.get("Permissions-Policy"), "camera=()");
  assert.equal(ok.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(ok.headers.get("X-Frame-Options"), "DENY");
  assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(ok.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.match(ok.headers.get("Vary") ?? "", /Cookie/);
});

test("ユーザー名の既定は admin。SSO共有鍵があればBasic認証の成功でセッションCookieを付ける", async () => {
  const env = { DASHBOARD_PASSWORD: "long-password", SSO_SHARED_SECRET: SHARED };
  const ok = await call(get("/", basic("admin", "long-password")), env);
  assert.equal(ok.status, 200);
  const cookie = (ok.headers.get("Set-Cookie") || "").split(";")[0];
  assert.match(cookie, /^personal_hub_session=/);
  // Cookieだけで2回目以降は通り、新しいCookieは付けない。
  const again = await call(get("/", { Cookie: cookie }), { SSO_SHARED_SECRET: SHARED });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("Set-Cookie"), null);
});

test("/auth/handoff は引き継ぎトークンを受理してセッションを作る", async () => {
  const env = { DASHBOARD_PASSWORD: "long-password", SSO_SHARED_SECRET: SHARED };
  const url = await createHandoffUrl(new URL("https://dashboard.example/"), env);
  assert.ok(url);
  const response = await call(new Request(url), env);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("Set-Cookie") || "", /personal_hub_session=/);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});

test("Cloudflare Accessモードは設定不足と不正JWTを拒否し、JWTの中身を出さない", async () => {
  assert.equal((await call(get("/"), { AUTH_MODE: "access" })).status, 503);
  const invalid = await call(
    get("/", { "Cf-Access-Jwt-Assertion": "not-a-jwt" }),
    { AUTH_MODE: "access", TEAM_DOMAIN: "https://owner.cloudflareaccess.com", POLICY_AUD: "audience" },
  );
  assert.equal(invalid.status, 403);
  assert.doesNotMatch(await invalid.text(), /not-a-jwt/);
  assert.equal(invalid.headers.get("Cache-Control"), "private, no-store");
});

test("AUTH_MODE が不正ならフェイルクローズする", async () => {
  const response = await call(get("/"), { AUTH_MODE: "none", DASHBOARD_PASSWORD: "p" });
  assert.equal(response.status, 503);
});

test("publicRoute の応答は認証なしで返り、他のパスは認証が要る", async () => {
  const env = { DASHBOARD_PASSWORD: "long-password" };
  assert.equal((await call(get("/public"), env, "open")).status, 200);
  assert.equal((await call(get("/public"), env, "open")).headers.get("Content-Security-Policy"), "default-src 'self'");
  assert.equal((await call(get("/private"), env)).status, 401);
});

test("alternativeCredential と Hubサービストークンは許可した資格だけを通す", async () => {
  const env = { DASHBOARD_PASSWORD: "long-password", HUB_SERVICE_TOKEN: HUB_TOKEN };
  assert.equal((await call(get("/api/items", { "X-Hub-Service": HUB_TOKEN }), env)).status, 200);
  assert.equal((await call(get("/api/other", { "X-Hub-Service": HUB_TOKEN }), env)).status, 401);
  assert.equal((await call(get("/api/items", { "X-Hub-Service": "wrong".padEnd(HUB_TOKEN.length, "x") }), env)).status, 401);
  assert.equal((await call(get("/other", { "X-Batch": "ok" }), env)).status, 200);
  assert.equal((await call(get("/other", { "X-Batch": "no" }), env)).status, 401);
});

test("isHubServiceRequest はGETだけ・許可パスだけ・32文字以上のトークンだけを通す", () => {
  const request = (path: string, init: RequestInit = {}) => new Request(`https://dashboard.example${path}`, { headers: { "X-Hub-Service": HUB_TOKEN }, ...init });
  assert.equal(isHubServiceRequest(request("/api/items"), { HUB_SERVICE_TOKEN: HUB_TOKEN }, ["/api/items"]), true);
  assert.equal(isHubServiceRequest(request("/api/items", { method: "POST" }), { HUB_SERVICE_TOKEN: HUB_TOKEN }, ["/api/items"]), false);
  assert.equal(isHubServiceRequest(request("/api/items/1"), { HUB_SERVICE_TOKEN: HUB_TOKEN }, ["/api/items"]), false);
  const short = "short-token";
  assert.equal(isHubServiceRequest(new Request("https://dashboard.example/api/items", { headers: { "X-Hub-Service": short } }), { HUB_SERVICE_TOKEN: short }, ["/api/items"]), false);
  assert.equal(isHubServiceRequest(request("/api/items"), {}, ["/api/items"]), false);
});

test("safeEqual は同じ文字列だけを真にする", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});
