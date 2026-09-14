import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDashboard } from "../functions/_shared/dashboard.ts";
import { onRequest as dashboardRoute } from "../functions/api/dashboard.ts";

test("dashboard summary and future navigation are normalized", () => {
  const dashboard = normalizeDashboard(
    [
      { id: 1, content: "Inbox A", status: "pending", created_at: "2026-09-13T00:00:00Z" },
      { id: 2, content: "Inbox B", status: "done", result: "moved", created_at: "2026-09-13T00:00:00Z" },
    ],
    [
      { id: 10, content: "Want A", status: "active", created_at: "2026-09-13T00:00:00Z" },
      { id: 11, content: "Want B", status: "active", created_at: "2026-09-13T00:00:00Z" },
    ],
    [{ id: 20, want_id: 10, content: "Action", status: "open", created_at: "2026-09-13T00:00:00Z" }],
    {
      NAV_KNOWLEDGE_URL: "https://knowledge.example/",
      NAV_FINANCIAL_URL: "javascript:alert(1)",
      NAV_TASK_BOARD_URL: "http://127.0.0.1:4173/",
    },
  );
  assert.deepEqual(dashboard.summary, {
    inboxTotal: 2,
    pendingInbox: 1,
    wantsTotal: 2,
    activeWants: 2,
    wantsWithoutAction: 1,
    openActions: 1,
  });
  assert.equal(dashboard.navigation[0].url, "/");
  assert.equal(dashboard.navigation[2].url, "/go/knowledge");
  assert.equal(dashboard.navigation[3].url, "/go/financial");
  assert.equal(dashboard.navigation[4].url, "http://127.0.0.1:4173/");
});

test("dashboard route sends the secret key only in server-side headers", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return Response.json([]);
  };
  try {
    const response = await dashboardRoute({
      request: new Request("https://compass.example/api/dashboard"),
      env: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-server-key" },
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((entry) => entry.headers.apikey === "secret-server-key"));
    assert.ok(requests.every((entry) => !("Authorization" in entry.headers)));
    assert.ok(requests.every((entry) => !entry.url.includes("secret-server-key")));
    assert.doesNotMatch(body, /secret-server-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dashboard route returns a generic error when server secrets are missing", async () => {
  const response = await dashboardRoute({
    request: new Request("https://compass.example/api/dashboard"),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "SUPABASE_NOT_CONFIGURED", message: "サーバーのSupabase接続設定が未完了です。" },
  });
});
