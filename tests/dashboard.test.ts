import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDashboard } from "../functions/_shared/dashboard.ts";
import { onRequest as dashboardRoute } from "../functions/api/dashboard.ts";

test("dashboard summary and future navigation are normalized", () => {
  const today = new Date().toISOString().slice(0, 10);
  const dashboard = normalizeDashboard(
    [
      { id: 1, content: "Inbox A", status: "pending", created_at: "2026-09-13T00:00:00Z" },
      { id: 2, content: "Inbox B", status: "done", result: "moved", created_at: "2026-09-13T00:00:00Z" },
    ],
    [
      { id: 10, content: "Want A", status: "completed", revisit_on: today, created_at: "2026-09-13T00:00:00Z" },
      { id: 11, content: "Want B", status: "active", revisit_on: "2099-01-01", created_at: "2026-09-13T00:00:00Z" },
    ],
    {
      NAV_KNOWLEDGE_URL: "https://knowledge.example/",
      NAV_FINANCIAL_URL: "javascript:alert(1)",
      NAV_TASK_BOARD_URL: "http://127.0.0.1:4173/",
    },
    [
      { id: 90, want_id: 10, intent: "explore", destination: "writing", status: "created", title: "Want A", created_at: "2026-09-14T00:00:00Z" },
      { id: 91, want_id: 11, intent: "continue", destination: "habit", status: "failed", title: "Want B", created_at: "2026-09-14T00:00:00Z" },
    ],
  );
  assert.deepEqual(dashboard.summary, {
    inboxTotal: 2,
    pendingInbox: 1,
    wantsTotal: 2,
    activeWants: 1,
    untriagedWants: 1,
    completedWants: 1,
    dueForReview: 0,
    knowledgePending: 0,
  });
  assert.equal(dashboard.wants[0].routes.length, 1);
  assert.equal(dashboard.wants[1].routes[0].status, "failed");
  assert.equal(dashboard.navigation.find((item) => item.id === "hub")?.url, "/");
  assert.equal(dashboard.navigation.find((item) => item.id === "habits")?.url, "/habits/");
  assert.equal(dashboard.navigation.find((item) => item.id === "writing")?.url, "/writing/");
  assert.equal(dashboard.navigation.find((item) => item.id === "knowledge")?.url, "/go/knowledge");
  assert.equal(dashboard.navigation.find((item) => item.id === "financial")?.url, "/go/financial");
  assert.equal(dashboard.navigation.find((item) => item.id === "task-board")?.url, "http://127.0.0.1:4173/");
});

test("Inbox rows carry where they were routed, from the linked Want or the result text", () => {
  const dashboard = normalizeDashboard(
    [
      { id: 1, content: "Knowledgeで確かめたい", status: "done", result: "Knowledge候補へ振り分け", created_at: "2026-09-20T00:00:00Z" },
      { id: 2, content: "書きたい", status: "done", result: "Writingへ振り分け", created_at: "2026-09-20T00:00:00Z" },
      { id: 3, content: "今は動かさない", status: "done", result: "寝かせる（再訪 2099-01-01）", created_at: "2026-09-20T00:00:00Z" },
      { id: 4, content: "未整理", status: "pending", created_at: "2026-09-20T00:00:00Z" },
      { id: 5, content: "旧データ", status: "done", result: "Wantsに登録", created_at: "2026-09-01T00:00:00Z" },
    ],
    [
      { id: 20, content: "Knowledgeで確かめたい", status: "completed", source_inbox_id: 1, created_at: "2026-09-20T00:00:00Z" },
      { id: 21, content: "今は動かさない", status: "active", revisit_on: "2099-01-01", source_inbox_id: 3, created_at: "2026-09-20T00:00:00Z" },
    ],
    {},
    [
      { id: 80, want_id: 20, intent: "explore", destination: "knowledge", status: "planned", title: "Knowledgeで確かめたい", created_at: "2026-09-20T01:00:00Z" },
    ],
  );

  const [knowledge, writing, deferred, untriaged, legacy] = dashboard.inbox;
  assert.deepEqual(knowledge.triage, {
    destinations: [{ destination: "knowledge", status: "planned" }],
    revisitOn: null,
    source: "route",
  });
  assert.deepEqual(writing.triage, {
    destinations: [{ destination: "writing", status: "created" }],
    revisitOn: null,
    source: "result",
  });
  assert.deepEqual(deferred.triage, { destinations: [], revisitOn: "2099-01-01", source: "route" });
  assert.deepEqual(untriaged.triage, { destinations: [], revisitOn: null, source: null });
  assert.deepEqual(legacy.triage, { destinations: [], revisitOn: null, source: null });
  assert.equal(dashboard.summary.knowledgePending, 1);
  assert.equal(dashboard.wants[0].sourceInboxId, 1);
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
