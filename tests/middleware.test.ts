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
  assert.equal(allowed.headers.get("Vary"), "Authorization");
  assert.match(allowed.headers.get("Content-Security-Policy") || "", /connect-src 'self'/);
});
