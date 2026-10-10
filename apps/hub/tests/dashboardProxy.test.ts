import assert from "node:assert/strict";
import test from "node:test";
import { proxyDashboardRequest } from "../functions/_shared/dashboardProxy.ts";
import { hasValidSession } from "../functions/_shared/sessionAuth.ts";

test("dashboard proxy keeps the public URL local and authenticates upstream with a host-bound session", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain", "Set-Cookie": "personal_hub_session=do-not-forward; Path=/" },
    });
  };

  try {
    const response = await proxyDashboardRequest({
      request: new Request("https://hub.example/finance/api/expenses?limit=10", {
        headers: { Authorization: "Basic abc", Cookie: "personal_hub_session=hub-token" },
      }),
      env: {
        SSO_SHARED_SECRET: "0123456789abcdef0123456789abcdef",
        NAV_FINANCIAL_URL: "https://finance.example/",
      },
    }, "finance");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Set-Cookie"), null);
    // 引き継ぎの往復をせず、上流のホスト向けに署名したセッションを1回目のリクエストに付ける。
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://finance.example/api/expenses?limit=10");
    const headers = new Headers(calls[0].init?.headers);
    const cookie = headers.get("Cookie") || "";
    assert.match(cookie, /^personal_hub_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const env = { SSO_SHARED_SECRET: "0123456789abcdef0123456789abcdef" };
    assert.equal(await hasValidSession(new Request("https://finance.example/", { headers: { Cookie: cookie } }), env), true);
    assert.equal(await hasValidSession(new Request("https://knowledge.example/", { headers: { Cookie: cookie } }), env), false);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Forwarded-Host"), "hub.example");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dashboard proxy rewrites same-origin upstream redirects back into the PWA scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { Location: "https://knowledge.example/?view=quiz" },
  });
  try {
    const response = await proxyDashboardRequest({
      request: new Request("https://hub.example/knowledge/auth/handoff"),
      env: { NAV_KNOWLEDGE_URL: "https://knowledge.example/" },
    }, "knowledge");
    assert.equal(response.headers.get("Location"), "https://hub.example/knowledge/?view=quiz");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
