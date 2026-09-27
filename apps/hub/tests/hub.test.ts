import assert from "node:assert/strict";
import test from "node:test";
import { journalTargets, journalTrendRange, loadHub, normalizeHub, normalizeJournalMoment, normalizeJournalTrend } from "../functions/_shared/hub.ts";
import { onRequest as hubRoute } from "../functions/api/hub.ts";

const now = new Date("2026-09-14T03:00:00.000Z");

test("hub combines sources and prioritizes the oldest pending Inbox items", () => {
  const hub = normalizeHub(
    [
      { id: 1, content: "Inbox one", status: "pending", created_at: "2026-09-01T00:00:00Z" },
      { id: 2, content: "Inbox two", status: "pending", created_at: "2026-09-02T00:00:00Z" },
      { id: 3, content: "Closed inbox", status: "done", created_at: "2026-09-03T00:00:00Z" },
    ],
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
      { id: "11111111-1111-4111-8111-111111111111", title: "Weak item", category: "SAP", times_asked: 4, accuracy: 50, next_review_on: "2026-09-15", created_at: "2026-08-01T00:00:00Z", archived: false },
      { id: "22222222-2222-4222-8222-222222222222", title: "Due item", category: "English", times_asked: 1, accuracy: 100, next_review_on: "2026-09-13", created_at: "2026-08-02T00:00:00Z", archived: false },
      { id: "33333333-3333-4333-8333-333333333333", title: "New item", category: "Tech", times_asked: 0, accuracy: null, next_review_on: null, created_at: "2026-09-14T00:00:00Z", archived: false },
    ],
    {},
    now,
  );

  assert.equal(hub.summary.currentMonthSpend, 1200);
  assert.equal(hub.summary.previousMonthSpend, 800);
  assert.equal(hub.summary.pendingInbox, 2);
  assert.equal(hub.summary.dueKnowledge, 1);
  assert.equal(hub.summary.weakKnowledge, 1);
  assert.equal(hub.summary.activeWants, 2);
  assert.equal(hub.summary.untriagedWants, 2);
  assert.equal(hub.navigation.knowledgeReview, "/knowledge/?view=quiz&mode=daily");
  assert.equal(hub.navigation.projects, "/projects/");
  assert.equal(hub.navigation.writing, "/writing/");
  assert.deepEqual(hub.inbox.map((item) => item.id), [1, 2]);
  assert.deepEqual(hub.inbox.map((item) => item.url), [
    "/compass/?view=inbox&id=1",
    "/compass/?view=inbox&id=2",
  ]);
  assert.deepEqual(hub.inbox.map((item) => item.ageDays), [13, 12]);
  assert.deepEqual(hub.knowledge.map((item) => item.reason), ["weak", "due", "new"]);
  assert.deepEqual(hub.knowledge.map((item) => item.url), [
    "/knowledge/?knowledge=11111111-1111-4111-8111-111111111111",
    "/knowledge/?knowledge=22222222-2222-4222-8222-222222222222",
    "/knowledge/?knowledge=33333333-3333-4333-8333-333333333333",
  ]);
  assert.equal(hub.recentExpenses[0].title, "Lunch");
});

test("Inbox preview keeps the three oldest pending items", () => {
  const inbox = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    content: `Inbox ${index + 1}`,
    status: index === 7 ? "done" : "pending",
    created_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const first = normalizeHub(inbox, [], [], [], {}, now).inbox.map((item) => item.id);
  const second = normalizeHub([...inbox].reverse(), [], [], [], {}, now).inbox.map((item) => item.id);
  assert.deepEqual(first, [1, 2, 3]);
  assert.deepEqual(first, second);
});

test("Wants summary treats every actionable Active Want as requiring organization", () => {
  const wants = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    content: `Want ${index + 1}`,
    status: index === 3 ? "completed" : "active",
    created_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const hub = normalizeHub([], wants, [], [], {}, now);
  assert.equal(hub.summary.activeWants, 6);
  assert.equal(hub.summary.untriagedWants, 6);
});

test("Hub keeps wishes and future deferred Wants active without counting them as untriaged", () => {
  const hub = normalizeHub([], [
    { id: 1, content: "未整理", status: "active", type: "want", created_at: "2026-09-01T00:00:00Z" },
    { id: 2, content: "欲しい", status: "active", type: "wish", created_at: "2026-09-02T00:00:00Z" },
    { id: 3, content: "寝かせる", status: "active", type: "want", revisit_on: "2099-01-01", created_at: "2026-09-03T00:00:00Z" },
  ], [], [], {}, now);

  assert.equal(hub.summary.activeWants, 3);
  assert.equal(hub.summary.untriagedWants, 1);
});

test("Hub exposes numeric Project and Writing card metrics", () => {
  const hub = normalizeHub(
    [],
    [],
    [],
    [],
    {},
    now,
    { inbox: true, wants: true, focus: true, projects: true, writing: true, expenses: true, knowledge: true, journal: true },
    [],
    null,
    [],
    null,
    [{ status: "active" }, { status: "waiting" }, { status: "completed" }],
    [{ status: "candidate" }, { status: "candidate" }, { status: "completed" }],
  );

  assert.equal(hub.summary.activeProjects, 2);
  assert.equal(hub.summary.writingIdeas, 2);
});

test("Focus preview keeps active items in board order and caps the Hub at five", () => {
  const focusRows = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    source_route_id: index + 101,
    source_want_id: index + 201,
    content: `Focus ${index + 1}`,
    note: index === 0 ? "First note" : null,
    status: index === 6 ? "archived" : "active",
    sort_order: 6 - index,
    created_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    updated_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const hub = normalizeHub(
    [],
    [],
    [],
    [],
    {},
    now,
    { inbox: true, wants: true, focus: true, projects: true, writing: true, expenses: true, knowledge: true, journal: true },
    [],
    null,
    focusRows,
  );
  assert.deepEqual(hub.focus.map((item) => item.id), [6, 5, 4, 3, 2]);
  assert.equal(hub.focus.length, 5);
  assert.equal(hub.summary.activeFocus, 5);
  assert.equal(hub.app.mode, "read-write");
});

test("unavailable sections use null summaries instead of misleading zeroes", () => {
  const hub = normalizeHub(
    [{ status: "pending" }],
    [{ id: 1, content: "Want", status: "active", created_at: "2026-09-01T00:00:00Z" }],
    [],
    [],
    {},
    now,
    { inbox: true, wants: true, focus: true, projects: true, writing: true, expenses: false, knowledge: false, journal: true },
  );
  assert.equal(hub.source.state, "partial");
  assert.deepEqual(hub.source.unavailable, ["expenses", "knowledge"]);
  assert.equal(hub.summary.currentMonthSpend, null);
  assert.equal(hub.summary.dueKnowledge, null);
  assert.equal(hub.summary.pendingInbox, 1);
  assert.equal(hub.summary.activeWants, 1);
});

test("Journal target dates use JST calendar subtraction and clamp month ends", () => {
  const targets = journalTargets(new Date("2024-03-31T03:00:00.000Z"));
  assert.deepEqual(targets.map((target) => target.targetDate), ["2024-02-29", "2023-09-30", "2023-03-31"]);
  assert.deepEqual(targets.map((target) => target.label), ["1か月前", "半年前", "1年前"]);
  const afterJstMidnight = journalTargets(new Date("2026-09-19T15:30:00.000Z"));
  assert.deepEqual(afterJstMidnight.map((target) => target.targetDate), ["2026-08-20", "2026-03-20", "2025-09-20"]);
});

test("Journal uses the closest past entry and exposes safe Notion links", () => {
  const target = { key: "oneMonth" as const, label: "1か月前", targetDate: "2026-08-31" };
  const moment = normalizeJournalMoment(target, {
    entry_date: "2026-08-28",
    summary: "振り返りの要約",
    emotion_summary: "落ち着いていた",
    mood: 1,
    emotions: ["安心"],
    themes: ["家族"],
    entities: ["Notion"],
    categories: ["日常"],
    source_pages: ["12345678-1234-1234-1234-1234567890ab", "invalid", "123456781234123412341234567890ab"],
  });
  assert.equal(moment.entry?.entryDate, "2026-08-28");
  assert.equal(moment.entry?.daysBeforeTarget, 3);
  assert.equal(moment.entry?.mood, 1);
  assert.deepEqual(moment.entry?.entities, ["Notion"]);
  assert.deepEqual(moment.entry?.sourcePageUrls, ["https://app.notion.com/123456781234123412341234567890ab"]);

  const future = normalizeJournalMoment(target, { entry_date: "2026-09-01", summary: "未来" });
  assert.equal(future.entry, null);
  assert.equal(normalizeJournalMoment(target, null).entry, null);
  assert.equal(normalizeJournalMoment(target, { entry_date: "2026-08-28", mood: null }).entry?.mood, null);
});

test("Journal trend uses JST dates, keeps missing days empty, and treats zero as a recorded mood", () => {
  const edge = new Date("2026-09-24T15:30:00.000Z");
  assert.equal(journalTrendRange(edge).endDate, "2026-09-25");
  const trend = normalizeJournalTrend([
    { entry_date: "2026-09-23", mood: -2 },
    { entry_date: "2026-09-24", mood: null },
    { entry_date: "2026-09-25", mood: 0 },
    { entry_date: "2026-09-26", mood: 2 },
    { entry_date: "2026-09-22", mood: 3 },
  ], edge);
  assert.equal(trend.days.length, 90);
  assert.deepEqual(trend.days.slice(-4), [
    { date: "2026-09-22", mood: null },
    { date: "2026-09-23", mood: -2 },
    { date: "2026-09-24", mood: null },
    { date: "2026-09-25", mood: 0 },
  ]);
});

test("Journal queries each target with a past-only descending lookup", async () => {
  const originalFetch = globalThis.fetch;
  const journalRequests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/daily_journal")) {
      journalRequests.push(url);
      const targetDate = url.searchParams.get("entry_date")?.replace("lte.", "") || "";
      const entryDate = targetDate === "2026-08-14" ? "2026-08-10" : targetDate;
      return Response.json([{ entry_date: entryDate, summary: `Journal ${targetDate}`, emotions: [], themes: [], categories: [], source_pages: [] }]);
    }
    return url.hostname.includes("pages.dev")
      ? Response.json({ items: [], total: 0, limit: 1000, offset: 0 })
      : Response.json([]);
  };
  try {
    const hub = await loadHub({
      SUPABASE_URL: "https://compass.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
    }, now);
    const moments = journalRequests.filter((url) => url.searchParams.get("select")?.includes("summary"));
    const trend = journalRequests.find((url) => url.searchParams.get("select") === "entry_date,mood");
    assert.equal(journalRequests.length, 4);
    assert.deepEqual(moments.map((url) => url.searchParams.get("entry_date")), ["lte.2026-08-14", "lte.2026-03-14", "lte.2025-09-14"]);
    assert.ok(moments.every((url) => url.searchParams.get("order") === "entry_date.desc" && url.searchParams.get("limit") === "1"));
    assert.equal(trend?.searchParams.get("and"), "(entry_date.gte.2026-06-17,entry_date.lte.2026-09-14)");
    assert.deepEqual(hub.journalMoments.map((item) => item.entry?.entryDate), ["2026-08-10", "2026-03-14", "2025-09-14"]);
    assert.equal(hub.journalMoments[0].entry?.daysBeforeTarget, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    assert.equal(requests.length, 14);
    assert.equal(requests.filter((entry) => entry.headers.apikey === "server-secret").length, 11);
    assert.equal(requests.filter((entry) => entry.headers["X-Hub-Service"] === "hub-service-token-that-is-at-least-32-characters").length, 3);
    assert.equal(requests.filter((entry) => entry.url.includes("/daily_journal?")).length, 4);
    assert.ok(requests.some((entry) => entry.url.includes("/projects?select=status")));
    assert.ok(requests.some((entry) => entry.url.includes("/writing_topics?select=status")));
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

test("Journal failure stays isolated from the other Hub sections", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/daily_journal?")) return Response.json({ error: "offline" }, { status: 503 });
    if (url.includes("pages.dev")) return Response.json({ items: [], total: 0, limit: 1000, offset: 0 });
    return Response.json([]);
  };
  try {
    const hub = await loadHub({
      SUPABASE_URL: "https://compass.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
    }, now);
    assert.equal(hub.source.state, "partial");
    assert.equal(hub.availability.journal, false);
    assert.equal(hub.availability.journalTrend, false);
    assert.equal(hub.availability.wants, true);
    assert.equal(hub.availability.expenses, true);
    assert.equal(hub.availability.knowledge, true);
    assert.deepEqual(hub.source.unavailable, ["journal", "journalTrend"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Journal trend failure keeps the existing retrospective cards available", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/daily_journal") && url.searchParams.get("select") === "entry_date,mood") {
      return Response.json({ error: "offline" }, { status: 503 });
    }
    if (url.pathname.endsWith("/daily_journal")) return Response.json([]);
    if (url.hostname.includes("pages.dev")) return Response.json({ items: [], total: 0, limit: 1000, offset: 0 });
    return Response.json([]);
  };
  try {
    const hub = await loadHub({
      SUPABASE_URL: "https://compass.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
    }, now);
    assert.equal(hub.availability.journal, true);
    assert.equal(hub.availability.journalTrend, false);
    assert.equal(hub.journalMoments.length, 3);
    assert.deepEqual(hub.source.unavailable, ["journalTrend"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid Focus data stays isolated from the other Hub sections", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/focus_items?")) return Response.json([{ id: "invalid" }]);
    if (url.includes("pages.dev")) return Response.json({ items: [], total: 0, limit: 1000, offset: 0 });
    return Response.json([]);
  };
  try {
    const hub = await loadHub({
      SUPABASE_URL: "https://compass.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
    }, now);
    assert.equal(hub.source.state, "partial");
    assert.equal(hub.availability.focus, false);
    assert.equal(hub.availability.wants, true);
    assert.deepEqual(hub.source.unavailable, ["focus"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hub does not depend on want_routes after successful routing auto-completes Wants", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/idea_inbox?")) return Response.json([
      { id: 9, content: "Handle this first", status: "pending", created_at: "2026-09-01T00:00:00Z" },
    ]);
    if (url.includes("/wants?")) return Response.json([
      { id: 1, content: "Still visible", status: "active", created_at: "2026-09-01T00:00:00Z" },
    ]);
    if (url.includes("pages.dev")) return Response.json({ items: [], total: 0, limit: 1000, offset: 0 });
    return Response.json([]);
  };
  try {
    const hub = await loadHub({
      SUPABASE_URL: "https://compass.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
    }, now);
    assert.equal(hub.source.state, "live");
    assert.equal(hub.availability.wants, true);
    assert.equal(hub.summary.activeWants, 1);
    assert.equal(hub.summary.untriagedWants, 1);
    assert.equal(hub.inbox[0].content, "Handle this first");
    assert.equal(hub.inbox[0].url, "/compass/?view=inbox&id=9");
    assert.ok(requests.some((url) => decodeURIComponent(url).includes("/idea_inbox?select=id,content,status,created_at")));
    assert.ok(!requests.some((url) => url.includes("/want_routes?")));
    assert.deepEqual(hub.source.unavailable, []);
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
