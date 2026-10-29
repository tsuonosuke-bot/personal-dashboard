import assert from "node:assert/strict";
import test from "node:test";
import { externalDashboardBase, fetchDashboard } from "../functions/_shared/dashboardInternal.ts";
import { fetchDashboardJson } from "../functions/_shared/hubSources.ts";

const env = { SUPABASE_URL: "https://compass.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };

test("NAV_*_URLは有効なHTTPS（とローカルのhttp）だけを外部接続として扱う", () => {
  assert.equal(externalDashboardBase(undefined), null);
  assert.equal(externalDashboardBase("  "), null);
  assert.equal(externalDashboardBase("javascript:alert(1)"), null);
  assert.equal(externalDashboardBase("http://example.com/"), null);
  assert.equal(externalDashboardBase("https://knowledge.example/"), "https://knowledge.example/");
  assert.equal(externalDashboardBase("http://localhost:8788/"), "http://localhost:8788/");
});

test("外部URLが無ければ、同じプロジェクトのハンドラを呼んでサービストークンを使わない", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; headers: Headers }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    for (const app of ["knowledge", "finance"] as const) {
      calls.length = 0;
      const response = await fetchDashboard(env, app, null, "/api/status", { headers: { Accept: "application/json" } });
      assert.notEqual(response.status, 404, app);
      assert.ok(calls.length > 0 && calls.every((call) => call.url.host === "compass.supabase.co"), `${app} handler reads Supabase directly`);
    }
    // トークンが無くても、内部の読み取りは設定エラーにならない。
    const failure = await fetchDashboardJson(env, "finance", null, "/api/status").then(() => null, (error: { code?: string }) => error);
    assert.notEqual(failure?.code, "HUB_SERVICE_NOT_CONFIGURED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("内部の呼び出しは許可した読み取りGETだけを通す", async () => {
  assert.equal((await fetchDashboard(env, "knowledge", null, "/api/knowledge/delete")).status, 404);
  assert.equal((await fetchDashboard(env, "finance", null, "/api/expenses")).status, 404);
});

test("外部URLがあれば従来どおりHTTPで取りに行き、サービストークンが要る", async () => {
  await assert.rejects(() => fetchDashboardJson(env, "knowledge", "https://knowledge.example/", "/api/status"), /service token/i);
  const originalFetch = globalThis.fetch;
  let seen: { url: string; token: string | null } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), token: new Headers(init?.headers).get("X-Hub-Service") };
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const token = "hub-service-token-that-is-at-least-32-characters";
    await fetchDashboardJson({ ...env, HUB_SERVICE_TOKEN: token }, "knowledge", "https://knowledge.example/", "/api/status");
    assert.deepEqual(seen, { url: "https://knowledge.example/api/status", token });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
