import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/_middleware.ts";

function request(authorization?: string) {
  return new Request("https://compass.example/", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

test("Basic auth fails closed when the password is missing", async () => {
  const response = await onRequest({ request: request(), env: {}, next: async () => new Response("private") });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("OAuth disclosure pages are public but do not open any other route", async () => {
  for (const path of ["/oauth/", "/oauth/privacy/", "/oauth/terms/", "/oauth.css"]) {
    const response = await onRequest({
      request: new Request(`https://compass.example${path}`),
      env: {},
      next: async () => new Response("public disclosure"),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "public disclosure");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
    assert.equal(response.headers.get("X-Robots-Tag"), "index, follow");
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  }

  const privateLookalike = await onRequest({
    request: new Request("https://compass.example/oauth/private"),
    env: {},
    next: async () => new Response("must stay private"),
  });
  assert.equal(privateLookalike.status, 503);

  const publicPost = await onRequest({
    request: new Request("https://compass.example/oauth/privacy/", { method: "POST" }),
    env: {},
    next: async () => new Response("must stay private"),
  });
  assert.equal(publicPost.status, 503);
});

test("Basic auth protects static assets and APIs with privacy headers", async () => {
  const env = { DASHBOARD_USER: "owner", DASHBOARD_PASSWORD: "long-password" };
  const denied = await onRequest({ request: request(), env, next: async () => new Response("private") });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("WWW-Authenticate") || "", /compass-dashboard/);

  const authorization = `Basic ${btoa("owner:long-password")}`;
  const allowed = await onRequest({ request: request(authorization), env, next: async () => new Response("private") });
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "private");
  assert.equal(allowed.headers.get("X-Frame-Options"), "DENY");
  assert.equal(allowed.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(allowed.headers.get("Vary") || "", /Cf-Access-Jwt-Assertion/);
  assert.match(allowed.headers.get("Content-Security-Policy") || "", /connect-src 'self'/);
});

test("Cloudflare Access mode fails closed without configuration or a valid JWT", async () => {
  const missing = await onRequest({
    request: request(),
    env: { AUTH_MODE: "access" },
    next: async () => new Response("private"),
  });
  assert.equal(missing.status, 503);

  const invalid = await onRequest({
    request: new Request("https://compass.example/", { headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" } }),
    env: { AUTH_MODE: "access", TEAM_DOMAIN: "https://owner.cloudflareaccess.com", POLICY_AUD: "audience" },
    next: async () => new Response("private"),
  });
  assert.equal(invalid.status, 403);
  assert.doesNotMatch(await invalid.text(), /not-a-jwt/);
});

const BASIC_ENV = { DASHBOARD_USER: "owner", DASHBOARD_PASSWORD: "long-password" };
const AUTHORIZATION = `Basic ${btoa("owner:long-password")}`;
const next = async () => new Response("private");

test("Knowledge・Finance配下だけがstyle属性を許すCSPになり、マイクを止めない", async () => {
  const hub = await onRequest({ request: request(AUTHORIZATION), env: BASIC_ENV, next });
  assert.doesNotMatch(hub.headers.get("Content-Security-Policy") || "", /style-src-attr/);
  assert.match(hub.headers.get("Permissions-Policy") || "", /microphone=\(\)/);

  for (const path of ["/knowledge/", "/knowledge/api/knowledge", "/finance/", "/finance/api/expenses"]) {
    const app = await onRequest({
      request: new Request(`https://compass.example${path}`, { headers: { Authorization: AUTHORIZATION } }),
      env: BASIC_ENV,
      next,
    });
    assert.match(app.headers.get("Content-Security-Policy") || "", /style-src-attr 'unsafe-inline'/, path);
    assert.equal(app.headers.get("Permissions-Policy"), null, path);
    assert.equal(app.headers.get("X-Frame-Options"), "DENY", path);
  }

  // 前方一致の取り違えを避ける。
  const lookalike = await onRequest({
    request: new Request("https://compass.example/knowledgebase", { headers: { Authorization: AUTHORIZATION } }),
    env: BASIC_ENV,
    next,
  });
  assert.doesNotMatch(lookalike.headers.get("Content-Security-Policy") || "", /style-src-attr/);
});

test("定期実行の合言葉はKnowledgeのバッチへのPOSTだけを通す", async () => {
  const env = { ...BASIC_ENV, REVIEW_BATCH_TOKEN: "t".repeat(32) };
  const batch = (path: string, method = "POST", token = "t".repeat(32)) =>
    onRequest({ request: new Request(`https://compass.example${path}`, { method, headers: { "X-Review-Batch-Token": token } }), env, next });
  assert.equal((await batch("/knowledge/api/review-batch/generate")).status, 200);
  assert.equal((await batch("/knowledge/api/embedding-batch")).status, 200);
  assert.equal((await batch("/knowledge/api/knowledge")).status, 401);
  assert.equal((await batch("/knowledge/api/review-batch/generate", "GET")).status, 401);
  assert.equal((await batch("/knowledge/api/review-batch/generate", "POST", "x".repeat(32))).status, 401);
});

test("Hubサービストークンは読み取り用GETだけを、Knowledge・Finance配下のパスで通す", async () => {
  const token = "h".repeat(32);
  const env = { ...BASIC_ENV, HUB_SERVICE_TOKEN: token };
  const read = (path: string, method = "GET") =>
    onRequest({ request: new Request(`https://compass.example${path}`, { method, headers: { "X-Hub-Service": token } }), env, next });
  assert.equal((await read("/knowledge/api/hub-summary")).status, 200);
  assert.equal((await read("/finance/api/expenses")).status, 200);
  assert.equal((await read("/finance/api/expenses", "POST")).status, 401);
  assert.equal((await read("/finance/api/budget-categories")).status, 401);
  assert.equal((await read("/api/expenses")).status, 401);
});
