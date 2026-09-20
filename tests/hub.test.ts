import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHub } from "../functions/_shared/hub.ts";
import { onRequest as hubRoute } from "../functions/api/hub.ts";

const now = new Date("2026-09-14T03:00:00.000Z");

test("hub combines finance, knowledge, inbox, and recent Active Wants", () => {
  const hub = normalizeHub(
    [{ status: "pending" }, { status: "done" }],
    [
      { id: 1, content: "Want one", status: "active", created_at: "2026-09-01T00:00:00Z" },
      { id: 2, content: "Want two", status: "active", created_at: "2026-09-02T00:00:00Z" },
      { id: 3, content: "Closed want", status: "completed", created_at: "2026-09-03T00:00:00Z" },
    ],
    [
      { id: 10, transaction_date: "2026-09-13", amount: 1200, title: "Lunch", category: "Food" },
      { id: 9, transaction_date: "2026-08-20", amount: 800, title: "Book", category: "Learning" },
    ],
    [
      { id: "weak", title: "Weak item", category: "SAP", times_asked: 4, accuracy: 50, next_review_on: "2026-09-15", created_at: "2026-08-01T00:00:00Z", archived: false },
      { id: "due", title: "Due item", category: "English", times_asked: 1, accuracy: 100, next_review_on: "2026-09-13", created_at: "2026-08-02T00:00:00Z", archived: false },
      { id: "new", title: "New item", category: "Tech", times_asked: 0, accuracy: null, next_review_on: null, created_at: "2026-09-14T00:00:00Z", archived: false },
    ],
    {},
    now,
  );

  assert.equal(hub.summary.currentMonthSpend, 1200);
  assert.equal(hub.summary.previousMonthSpend, 800);
  assert.equal(hub.summary.pendingInbox, 1);
  assert.equal(hub.summary.dueKnowledge, 1);
  assert.equal(hub.summary.weakKnowledge, 1);
  assert.equal(hub.summary.activeWants, 2);
  assert.equal(hub.navigation.knowledgeReview, "/go/knowledge?view=quiz");
  assert.deepEqual(hub.wants.map((item) => item.id), [2, 1]);
  assert.deepEqual(hub.knowledge.map((item) => item.reason), ["weak", "due", "new"]);
  assert.equal(hub.recentExpenses[0].title, "Lunch");
});

test("Wants preview keeps the three newest Active Wants", () => {
  const wants = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    content: `Want ${index + 1}`,
    status: index === 7 ? "completed" : "active",
    created_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const first = normalizeHub([], wants, [], [], {}, now).wants.map((item) => item.id);
  const second = normalizeHub([], [...wants].reverse(), [], [], {}, now).wants.map((item) => item.id);
  assert.deepEqual(first, [7, 6, 5]);
  assert.deepEqual(first, second);
});

test("unavailable sections use null summaries instead of misleading zeroes", () => {
  const hub = normalizeHub(
    [{ status: "pending" }],
    [{ id: 1, content: "Want", status: "active", created_at: "2026-09-01T00:00:00Z" }],
    [],
    [],
    {},
    now,
    { inbox: true, wants: true, expenses: false, knowledge: false },
  );
  assert.equal(hub.source.state, "partial");
  assert.deepEqual(hub.source.unavailable, ["expenses", "knowledge"]);
  assert.equal(hub.summary.currentMonthSpend, null);
  assert.equal(hub.summary.dueKnowledge, null);
  assert.equal(hub.summary.pendingInbox, 1);
  assert.equal(hub.summary.activeWants, 1);
});

test("hub route keeps the Supabase secret in server-side headers", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return String(input).includes("pages.dev")
      ? Response.json({ items: [], total: 0, limit: 1000, offset: 0 })
      : Response.json([]);
  };
  try {
    const response = await hubRoute({
      request: new Request("https://hub.example/api/hub"),
      env: {
        SUPABASE_URL: "https://compass.supabase.co",
        SUPABASE_SECRET_KEY: "server-secret",
        HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
      },
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(requests.length, 4);
    assert.equal(requests.filter((entry) => entry.headers.apikey === "server-secret").length, 2);
    assert.equal(requests.filter((entry) => entry.headers["X-Hub-Service"] === "hub-service-token-that-is-at-least-32-characters").length, 2);
    assert.ok(requests.every((entry) => !entry.url.includes("secret")));
    assert.doesNotMatch(body, /server-secret|hub-service-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hub route keeps successful sections when one upstream is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("financial-dashboard")) return Response.json({ error: "offline" }, { status: 503 });
    if (url.includes("knowledge-dashboard")) return Response.json({ items: [], total: 0, limit: 1000, offset: 0 });
    return Response.json([]);
  };
  try {
    const response = await hubRoute({
      request: new Request("https://hub.example/api/hub"),
      env: {
        SUPABASE_URL: "https://compass.supabase.co",
        SUPABASE_SECRET_KEY: "server-secret",
        HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
      },
    });
    const body = await response.json() as {
      source: { state: string };
      availability: { expenses: boolean; knowledge: boolean };
      summary: { currentMonthSpend: number | null; dueKnowledge: number | null };
    };
    assert.equal(response.status, 200);
    assert.equal(body.source.state, "partial");
    assert.equal(body.availability.expenses, false);
    assert.equal(body.availability.knowledge, true);
    assert.equal(body.summary.currentMonthSpend, null);
    assert.equal(body.summary.dueKnowledge, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hub route still fails closed when every source is unavailable", async () => {
  const response = await hubRoute({
    request: new Request("https://hub.example/api/hub"),
    env: {},
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /SUPABASE_SECRET_KEY|HUB_SERVICE_TOKEN/);
});
