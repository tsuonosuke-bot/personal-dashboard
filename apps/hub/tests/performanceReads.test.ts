import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadHub } from "../functions/_shared/hub.ts";
import { sourceDeadline } from "../functions/_shared/hubSources.ts";
import { loadIdeaReadModel, readIdeaQuery } from "../functions/_shared/dashboardRead.ts";
import { loadProjectReadModel, projectMutationResult } from "../functions/_shared/projectsRead.ts";
import { projectMilestoneProgress } from "../functions/_shared/projectModel.ts";
import { groupMilestoneActions } from "../public/projects/milestones.js";
import { mapConcurrent as browserQueue } from "../public/shared/concurrency.js";
import {
  GOOGLE_EVENT_CONCURRENCY,
  readGoogleCalendarEventsPartial,
  encryptGoogleCalendarRefreshToken,
  forgetGoogleAccessToken,
} from "../functions/_shared/googleCalendar.ts";
import { listScheduledActions } from "../functions/_shared/scheduledActions.ts";
import {
  loadHabitMutationResult,
  normalizeHabits,
  normalizeHabitHistory,
} from "../functions/_shared/habits.ts";
import { onRequest as todayRoute } from "../functions/api/today.ts";
import { onRequest as bulkRoute } from "../functions/api/inbox-bulk.ts";
import { hubReadFixture, ideaReadFixture, projectReadFixture } from "./readModelFixtures.ts";

const env = {
  SUPABASE_URL: "https://perf.supabase.co",
  SUPABASE_SECRET_KEY: "test-server-key",
  HUB_SERVICE_TOKEN: "test-hub-service-token-at-least-32-characters", NAV_KNOWLEDGE_URL: "https://knowledge-50b.pages.dev/", NAV_FINANCIAL_URL: "https://finance-9qq.pages.dev/",
  GOOGLE_OAUTH_CLIENT_ID: "client",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};
const stamp = "2026-10-20T00:00:00.123456+00:00";
const schedule = {
  date: "2099-10-26",
  allDay: true,
  startTime: null,
  endTime: null,
  timeZone: "Asia/Tokyo",
};
const project = {
  id: 1,
  title: "Project",
  outcome: "Outcome",
  theme: null,
  status: "active",
  target_on: null,
  review_on: null,
  waiting_for: null,
  completed_at: null,
  created_at: stamp,
  updated_at: stamp,
};
const action = {
  id: 1,
  project_id: 1,
  project_item_id: null,
  milestone_id: null,
  content: "Next",
  status: "next",
  start_on: null,
  due_on: null,
  sort_order: null,
  waiting_for: null,
  completed_at: null,
  created_at: stamp,
  updated_at: stamp,
};
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function calendarFixture(statuses: string[]) {
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh", env);
  const rows = statuses.map((status, index) => ({
    id: index + 1,
    source_route_id: index + 101,
    status,
    current_schedule: schedule,
    completed_at: status === "completed" ? stamp : null,
    note: null,
    reschedule_count: 0,
    last_calendar_sync_at: null,
    created_at: stamp,
    updated_at: stamp,
    google_event_id: null,
    calendar_title: null,
    calendar_url: null,
    calendar_etag: null,
    calendar_state: "confirmed",
  }));
  const counts = { table: 0, google: 0, rows: 0 };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/scheduled_actions")) {
      counts.table++;
      let selected = rows;
      const status = url.searchParams.get("status");
      if (status === "eq.pending") selected = selected.filter((row) => row.status === "pending");
      if (status === "in.(completed,skipped)")
        selected = selected.filter((row) => row.status !== "pending");
      const ids = url.searchParams.get("id");
      if (ids?.startsWith("in.(")) {
        const wanted = new Set(ids.slice(4, -1).split(",").map(Number));
        selected = selected.filter((row) => wanted.has(row.id));
      }
      selected = selected.slice(
        Number(url.searchParams.get("offset") || 0),
        Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 1000),
      );
      counts.rows += selected.length;
      return Response.json(selected);
    }
    if (url.pathname.endsWith("/get_scheduled_action_counts"))
      return Response.json({
        pending: statuses.filter((s) => s === "pending").length,
        completed: statuses.filter((s) => s === "completed").length,
        skipped: statuses.filter((s) => s === "skipped").length,
      });
    if (url.pathname.endsWith("/want_routes")) {
      const wanted = new Set(
        (url.searchParams.get("id") || "").slice(4, -1).split(",").map(Number),
      );
      return Response.json(
        rows
          .filter((row) => wanted.has(row.source_route_id))
          .map((row) => ({
            id: row.source_route_id,
            want_id: row.id,
            title: `Event ${row.id}`,
            detail: null,
            target_id: `event-${row.id}`,
            target_url: null,
          })),
      );
    }
    if (url.pathname.endsWith("/wants"))
      return Response.json(
        rows.map((row) => ({ id: row.id, content: `Want ${row.id}`, source_inbox_id: null })),
      );
    if (url.pathname.endsWith("/integration_connections"))
      return Response.json([
        {
          provider: "google_calendar",
          encrypted_credentials: encrypted,
          scope: "https://www.googleapis.com/auth/calendar.events",
        },
      ]);
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "access", expires_in: 3599 });
    if (url.hostname === "www.googleapis.com") {
      counts.google++;
      const id = url.pathname.split("/").pop()!;
      return Response.json({
        id,
        status: "confirmed",
        summary: id,
        etag: `etag-${id}`,
        start: { date: schedule.date },
        end: { date: "2099-10-27" },
      });
    }
    if (url.pathname.endsWith("/get_project_read_model")) {
      const raw = { ...action, project_action_todos: { scheduled_action_id: 1 } };
      return Response.json(projectReadFixture([project], [raw]));
    }
    throw new Error(`Unexpected ${url.pathname} ${init?.method}`);
  };
  return { rows, counts, fetcher };
}

test("C02: Hub fetches only compact summaries and preserves preview/count values", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    paths.push(new URL(String(input)).pathname);
    return hubReadFixture(input, init, {
      inbox: {
        pendingInbox: 50003,
        items: [{ id: 1, content: "Oldest", status: "pending", created_at: stamp }],
      },
      wants: { activeWants: 50000, untriagedWants: 12 },
    });
  };
  try {
    const result = await loadHub(env, new Date("2026-10-26T03:00:00Z"));
    assert.equal(result.summary.pendingInbox, 50003);
    assert.equal(result.summary.activeWants, 50000);
    assert.equal(result.inbox[0].id, 1);
    assert.equal(paths.filter((p) => p === "/api/hub-summary").length, 2);
    assert.equal(
      paths.some((p) =>
        [
          "/api/knowledge",
          "/api/expenses",
          "/rest/v1/idea_inbox",
          "/rest/v1/wants",
          "/rest/v1/projects",
          "/rest/v1/habits",
        ].includes(p),
      ),
      false,
    );
    assert.equal(result.source.state, "live");
  } finally {
    globalThis.fetch = original;
  }
});

test("C07: held source expires, healthy result survives, retry recovers without late replacement", async () => {
  let release!: (value: string) => void;
  const held = new Promise<string>((resolve) => {
    release = resolve;
  });
  const healthy = Promise.resolve("healthy");
  const results = await Promise.allSettled([sourceDeadline(healthy, 10), sourceDeadline(held, 10)]);
  assert.deepEqual(results[0], { status: "fulfilled", value: "healthy" });
  assert.equal(results[1].status, "rejected");
  const retry = await sourceDeadline(Promise.resolve("newest"), 10);
  release("stale");
  await tick(0);
  assert.equal(retry, "newest");
});

test("C07: a held Knowledge peer returns partial Hub sections and recovers on a new request", async () => {
  const original = globalThis.fetch;
  let release!: (response: Response) => void;
  let hold = true;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (input, init) =>
    new URL(String(input)).hostname.includes("knowledge") &&
    new URL(String(input)).pathname === "/api/hub-summary" &&
    hold
      ? held
      : hubReadFixture(input, init);
  try {
    const first = await loadHub(env, new Date("2026-10-26T03:00:00Z"), { sourceTimeoutMs: 10 });
    assert.equal(first.availability.knowledge, false);
    assert.equal(first.summary.dueKnowledge, null);
    assert.equal(first.availability.inbox, true);
    assert.equal(first.availability.expenses, true);
    hold = false;
    const second = await loadHub(env, new Date("2026-10-26T03:00:01Z"), { sourceTimeoutMs: 20 });
    release(hubReadFixture(new URL("https://knowledge.test/api/hub-summary")));
    assert.equal(second.availability.knowledge, true);
    assert.equal(second.summary.dueKnowledge, 0);
    assert.equal(first.summary.dueKnowledge, null);
  } finally {
    hold = false;
    globalThis.fetch = original;
  }
});

test("C04: eight current ToDos and one Project link share one table read and eight Google GETs", async () => {
  const original = globalThis.fetch;
  const fixture = await calendarFixture(Array(8).fill("pending"));
  globalThis.fetch = fixture.fetcher;
  try {
    forgetGoogleAccessToken();
    await Promise.all([listScheduledActions(env), listScheduledActions(env)]);
    assert.equal(fixture.counts.table, 2);
    assert.equal(fixture.counts.google, 16);
    fixture.counts.table = fixture.counts.google = 0;
    const response = await todayRoute({ request: new Request("https://hub.test/api/today"), env });
    const payload = await response.json();
    assert.equal(fixture.counts.table, 1);
    assert.equal(fixture.counts.google, 8);
    assert.equal(payload.todos.data.items.length, 8);
    assert.equal(payload.projects.data.projects[0].nextAction.linkedTodo.id, 1);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  } finally {
    forgetGoogleAccessToken();
    globalThis.fetch = original;
  }
});

test("C04: a mutation starts a fresh shared Today read and an old completion cannot clear it", async () => {
  const source = await readFile(new URL("../public/today/controller.js", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("  function combinedSource("), source.indexOf("\n  function applyProjectResult("));
  const releases: Array<(value: unknown) => void> = [];
  const create = new Function("requestJson", `const localEdits={todos:0,projects:0};let pendingCombined=null;${helper};return {read:combinedSource,edit(){localEdits.todos++;}};`);
  const harness = create(() => new Promise((resolve) => { releases.push(resolve); }));
  const oldTodos = harness.read("todos"); const oldProjects = harness.read("projects");
  assert.equal(releases.length, 1);
  harness.edit(); const newTodos = harness.read("todos"); const newProjects = harness.read("projects");
  assert.equal(releases.length, 2);
  releases[0]({todos:{data:{revision:0}},projects:{data:{revision:0}}}); await Promise.all([oldTodos,oldProjects]);
  const stillNew = harness.read("todos");assert.equal(releases.length, 2);
  releases[1]({todos:{data:{revision:1}},projects:{data:{revision:1}}});
  assert.deepEqual(await Promise.all([newTodos,newProjects,stillNew]),[{revision:1},{revision:1},{revision:1}]);
});

test("C08: initial pending synchronization is independent of completed history; history and IDs are explicit", async () => {
  const original = globalThis.fetch;
  try {
    for (const completed of [6, 106]) {
      const fixture = await calendarFixture([
        "pending",
        ...Array(completed).fill("completed"),
        "skipped",
      ]);
      globalThis.fetch = fixture.fetcher;
      forgetGoogleAccessToken();
      const current = await listScheduledActions(env, { scope: "current" });
      assert.equal(current.items.length, 1);
      assert.equal(fixture.counts.rows, 1);
      assert.equal(fixture.counts.google, 1);
      assert.equal(current.summary.completed, completed);
      const history = await listScheduledActions(env, { scope: "history", limit: 2, offset: 0 });
      assert.equal(history.items.length, 2);
      assert.equal(history.page.hasMore, true);
      assert.equal(fixture.counts.google, 3);
      const direct = await listScheduledActions(env, { ids: [2] });
      assert.equal(direct.items[0].status, "completed");
      assert.equal(fixture.counts.google, 4);
    }
  } finally {
    forgetGoogleAccessToken();
    globalThis.fetch = original;
  }
});

test("C09: bounded Google reads retain normal events through 429, timeout and failure, and retry only failed IDs", async () => {
  const original = globalThis.fetch;
  let active = 0,
    max = 0;
  const attempts = new Map<string, number>();
  let recover = false;
  globalThis.fetch = async (input, init) => {
    const id = new URL(String(input)).pathname.split("/").pop()!;
    active++;
    max = Math.max(max, active);
    attempts.set(id, (attempts.get(id) || 0) + 1);
    try {
      assert.ok(init?.signal);
      if (id === "slow" && !recover)
        await new Promise((_, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("deadline")), {
            once: true,
          });
        });
      await tick(2);
      if (id === "rate" && attempts.get(id) === 1) return new Response("", { status: 429 });
      if (id === "failed" && !recover) return new Response("", { status: 500 });
      if (id === "missing") return new Response("", { status: 404 });
      return Response.json({
        id,
        status: "confirmed",
        etag: `etag-${id}`,
        summary: id,
        start: { date: "2099-10-26" },
        end: { date: "2099-10-27" },
      });
    } finally {
      active--;
    }
  };
  try {
    const ids = ["a", "b", "rate", "slow", "failed", "missing", "c", "d"];
    const result = await readGoogleCalendarEventsPartial(env, ids, Promise.resolve("access"), {
      timeoutMs: 12,
      retryDelayMs: 0,
    });
    assert.ok(max <= GOOGLE_EVENT_CONCURRENCY);
    assert.equal(result.events.size, 6);
    assert.deepEqual([...result.failures.keys()], ["slow", "failed"]);
    assert.equal(result.events.get("missing")?.status, "missing");
    assert.equal(result.events.has("failed"), false);
    assert.equal(attempts.get("rate"), 2);
    assert.equal(attempts.get("a"), 1);
    assert.equal(attempts.get("slow"), 2);
    recover = true;
    const before = attempts.get("a");
    const retried = await readGoogleCalendarEventsPartial(
      env,
      [...result.failures.keys()],
      Promise.resolve("access"),
      { timeoutMs: 20, retryDelayMs: 0 },
    );
    assert.equal(retried.failures.size, 0);
    assert.equal(retried.events.size, 2);
    assert.equal(attempts.get("a"), before);
  } finally {
    globalThis.fetch = original;
  }
});

test("C10/C11: Project read/mutation refresh is scoped and preserves independent global counts", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      path: new URL(String(input)).pathname,
      body: JSON.parse(String(init?.body || "{}")),
    });
    const model = projectReadFixture([project], [action]);
    model.summary.completed = 50000;
    return Response.json(model);
  };
  try {
    const list = await loadProjectReadModel(env, { view: "active", search: "  ancient history  " });
    assert.equal(list.summary.completed, 50000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.p_search, "ancient history");
    const mutation = await projectMutationResult(
      env,
      1,
      new Request("https://hub.test/api/project-actions?view=active&q=ancient+history"),
    );
    assert.equal(calls[1].body.p_project_id, 1);
    assert.equal(calls[1].body.p_search, "ancient history");
    assert.equal("partial" in mutation && mutation.partial, true);
    assert.ok(calls.every((call) => call.path === "/rest/v1/rpc/get_project_read_model"));
    globalThis.fetch = async () => new Response("", { status: 503 });
    const saved = await projectMutationResult(env, 1);
    assert.equal("saved" in saved && saved.saved, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("C10/C11: review count uses live queued Calendar dates, then refreshes only the saved Project", async () => {
  const original = globalThis.fetch;
  const fixture = await calendarFixture(["pending", "pending"]);
  const googleIds: string[] = [];
  const cacheWrites: Array<Array<{ id: number; effective_date: string }>> = [];
  let savedProject = false;
  let unavailable = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/get_project_read_model")) {
      const args = JSON.parse(String(init?.body));
      const linkedAction = { ...action, project_action_todos: { scheduled_action_id: 1 } };
      const base = projectReadFixture([project], [linkedAction]);
      const rows = args.p_project_id
        ? [{ todoId: 1, projectId: 1, date: "2026-10-25" }]
        : [
            { todoId: 1, projectId: 1, date: "2099-10-26" },
            { todoId: 2, projectId: 2, date: "2099-10-26" },
          ];
      return Response.json({
        ...base,
        summary: { ...base.summary, reviewPending: args.p_project_id ? 1 : 0 },
        reviewCalendarActions: rows,
      });
    }
    if (url.pathname.endsWith("/record_project_todo_read_cache")) {
      cacheWrites.push(JSON.parse(String(init?.body)).p_items);
      return new Response(null, { status: 204 });
    }
    if (url.hostname === "www.googleapis.com") {
      const id = url.pathname.split("/").pop()!;
      googleIds.push(id);
      if (unavailable) return new Response("", { status: 500 });
      const date = id === "event-1" && !savedProject ? "2026-10-25" : "2099-10-26";
      return Response.json({
        id,
        status: "confirmed",
        etag: `etag-${id}`,
        start: { date },
        end: { date: date === "2026-10-25" ? "2026-10-26" : "2099-10-27" },
      });
    }
    return fixture.fetcher(input, init);
  };
  try {
    forgetGoogleAccessToken();
    const initial = await loadProjectReadModel(
      env,
      {},
      undefined,
      new Date("2026-10-26T03:00:00Z"),
    );
    assert.equal(initial.summary.reviewPending, 1);
    assert.deepEqual(googleIds.sort(), ["event-1", "event-2"]);
    assert.equal(cacheWrites[0].length, 2);
    assert.equal(cacheWrites[0][0].effective_date, "2026-10-25");
    savedProject = true;
    const refreshed = await loadProjectReadModel(
      env,
      { projectId: 1 },
      undefined,
      new Date("2026-10-26T03:00:01Z"),
    );
    assert.equal(refreshed.summary.reviewPending, 0);
    assert.equal(googleIds.filter((id) => id === "event-2").length, 1);
    assert.equal(cacheWrites[1].length, 1);
    assert.equal(cacheWrites[1][0].id, 1);
    unavailable = true;
    const fallback = await loadProjectReadModel(env, { projectId: 1 }, undefined, new Date("2026-10-26T03:00:02Z"));
    assert.equal(fallback.summary.reviewPending, 1);
    assert.equal(fallback.projects[0].nextAction?.dueOn, "2026-10-25");
    assert.equal(fallback.projects[0].nextAction?.linkedTodo?.schedule.date, "2026-10-25");
    assert.equal(fallback.projects[0].nextAction?.linkedTodo?.calendarState, "unavailable");
    assert.equal(fallback.source.state, "partial");
    assert.equal(cacheWrites.length, 2);
  } finally {
    forgetGoogleAccessToken();
    globalThis.fetch = original;
  }
});

test("C10: a saved Project that no longer matches a full-history search carries false matching state", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const fixture = projectReadFixture([{ ...project, title: "Renamed" }], [action]);
    fixture.projects[0].context_matches = false;
    return Response.json({ ...fixture, page: { ...fixture.page, contextTotal: 0 } });
  };
  try {
    const result = await loadProjectReadModel(env, { projectId: 1, search: "Needle" });
    assert.equal(result.projects[0].searchMatched, false);
    assert.equal(result.page.contextTotal, 0);
    const modelSource = await readFile(
      new URL("../public/projects/model.js", import.meta.url),
      "utf8",
    );
    const createModel = new Function(
      `${modelSource.replace("export function", "function")}; return createProjectModel;`,
    )();
    const state = { data: result, search: "Needle", view: "active", attentionOnly: false };
    assert.deepEqual(createModel({ state }).projectsForView(), []);
  } finally {
    globalThis.fetch = original;
  }
});

test("C12: server and browser classify each Action once at 100/200/400, preserving groups and cancellation counts", () => {
  for (const size of [100, 200, 400]) {
    let serverReads = 0,
      browserReads = 0;
    const milestones = Array.from({ length: size }, (_, index) => ({ id: index + 1 }));
    const server = Array.from({ length: size }, (_, index) => ({
      get milestoneId() {
        serverReads++;
        return index % 7 === 0 ? null : index + 1;
      },
      status:
        index % 3 === 0
          ? ("cancelled" as const)
          : index % 3 === 1
            ? ("done" as const)
            : ("queued" as const),
    }));
    const client = Array.from({ length: size }, (_, index) => ({
      id: index + 1,
      get milestoneId() {
        browserReads++;
        return index % 7 === 0 ? null : index + 1;
      },
    }));
    const progress = projectMilestoneProgress(server);
    const groups = groupMilestoneActions(client, milestones);
    assert.equal(serverReads, size);
    assert.equal(browserReads, size);
    assert.equal(groups.loose.length, Math.ceil(size / 7));
    for (let index = 0; index < size; index++) {
      if (index % 7 === 0 || index % 3 === 0) assert.equal(progress.has(index + 1), false);
      else assert.deepEqual(progress.get(index + 1), { total: 1, done: index % 3 === 1 ? 1 : 0 });
    }
  }
});

test("C13: empty Idea model is valid and selected-tab/read-page/direct-ID context stays bounded", async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ ...ideaReadFixture(), statuses: [] });
  };
  try {
    const query = readIdeaQuery(
      new URL("https://hub.test/api/dashboard?view=inbox&status=pending&offset=50&q=%20old%20"),
    )!;
    const model = await loadIdeaReadModel(env, query);
    assert.deepEqual(model.inbox, []);
    assert.deepEqual(model.statuses, []);
    assert.equal(body.p_view, "inbox");
    assert.equal(body.p_offset, 50);
    assert.equal(body.p_search, "old");
    assert.equal(body.p_limit, 50);
    assert.equal(readIdeaQuery(new URL("https://hub.test/api/dashboard?limit=1000")), null);
    const sql = await readFile(
      new URL("../supabase/migrations/20261026040500_idea_read_model.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /r\.status in \('planned','created'\)/);
    assert.match(
      sql,
      /not exists\(select 1 from public\.want_routes r where r\.want_id=w\.id and r\.destination=p_filter and r\.status='created'\)/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("C14: twenty actual Inbox edit submissions only PATCH Inbox; save failure never applies a local success", async () => {
  const source = await readFile(
    new URL("../public/compass/edit-forms.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function saveInbox(");
  const end = source.indexOf("\n// 分類の選択肢", start);
  const handlerSource = source.slice(start, end);
  const requests: string[] = [];
  let applied = 0;
  let saved = { id: 1, content: "old", status: "pending", result: null, created_at: stamp };
  let failure = false;
  let errorText = "";
  const controls = { disabled: false, textContent: "", isConnected: true };
  const handler = new Function(
    "document",
    "fetch",
    "readApiJson",
    "applySavedIdeaRow",
    "loadIdeaDetail",
    "state",
    "renderDrawerItem",
    "showToast",
    "setInboxEditError",
    `${handlerSource}; return saveInbox;`,
  )(
    { getElementById: () => controls },
    async (url: string, init: RequestInit) => {
      requests.push(`${init.method} ${url}`);
      if (failure) return Response.json({ error: "conflict" }, { status: 409 });
      saved = { ...saved, ...JSON.parse(String(init.body)) };
      return Response.json(saved);
    },
    (response: Response) => response.json(),
    (_view: string, row: typeof saved) => {
      applied++;
      return row;
    },
    async () => {
      throw new Error("unexpected refresh");
    },
    { drawerItem: { id: 1 } },
    () => {},
    () => {},
    (text: string) => {
      errorText = text;
    },
  );
  for (let index = 0; index < 20; index++)
    await handler(
      {
        preventDefault() {},
        currentTarget: {
          elements: {
            content: { value: `edit ${index}` },
            status: { value: "pending" },
            result: { value: null },
          },
        },
      },
      saved,
    );
  assert.equal(applied, 20);
  assert.equal(requests.length, 20);
  assert.ok(requests.every((url) => url === "PATCH /api/inbox"));
  failure = true;
  await handler(
    {
      preventDefault() {},
      currentTarget: {
        elements: {
          content: { value: "failed" },
          status: { value: "pending" },
          result: { value: null },
        },
      },
    },
    saved,
  );
  assert.equal(applied, 20);
  assert.equal(errorText, "conflict");
  assert.equal(saved.content, "edit 19");
});

test("C15: forty independent optimistic updates keep results ordered at four workers; browser stop retains unstarted entries", async () => {
  const original = globalThis.fetch;
  let active = 0,
    max = 0,
    requests = 0;
  globalThis.fetch = async (input, init) => {
    active++;
    max = Math.max(max, active);
    requests++;
    try {
      await tick(2);
      const url = new URL(String(input));
      const id = Number(url.searchParams.get("id")?.slice(3));
      assert.equal(url.searchParams.get("content"), `eq.Item ${id}`);
      if (id === 7) return Response.json([]);
      if (id === 8) return new Response("", { status: 500 });
      return Response.json([{ id, ...JSON.parse(String(init?.body)) }]);
    } finally {
      active--;
    }
  };
  try {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      original: { content: `Item ${index + 1}`, status: "pending", result: null },
    }));
    const response = await bulkRoute({
      env,
      request: new Request("https://hub.test/api/inbox-bulk", {
        method: "PATCH",
        headers: {
          Origin: "https://hub.test",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "inbox-bulk-update",
        },
        body: JSON.stringify({ status: "done", items }),
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 207);
    assert.equal(requests, 40);
    assert.equal(max, 4);
    assert.deepEqual(
      payload.failed.map((item: { id: number }) => item.id),
      [7, 8],
    );
    assert.equal(payload.updated.length, 38);
    let stop = false,
      started = 0;
    const keys = new Map<number, string>();
    const values = Array.from({ length: 40 }, (_, i) => i);
    const first = await browserQueue(
      values,
      3,
      async (value) => {
        started++;
        keys.set(value, keys.get(value) || `key-${value}`);
        await tick(1);
        if (value === 0) stop = true;
        return value;
      },
      () => stop,
    );
    assert.ok(started <= 3);
    const remaining = values.filter((_, index) => !first[index]);
    assert.equal(remaining.length, 40 - started);
    await browserQueue(remaining, 3, async (value) => {
      keys.set(value, keys.get(value) || `key-${value}`);
      return value;
    });
    assert.equal(keys.size, 40);
  } finally {
    globalThis.fetch = original;
  }
});

test("C15: route and status results survive a second-page refresh failure and retry only fixed failed snapshots", async () => {
  const source = (await readFile(new URL("../public/compass/bulk.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?$/gm, "")
    .replace(/\bexport /g, "");
  for (const mode of ["route", "status"]) {
    const items = [1, 2, 3].map((id) => ({ id, content: `Original ${id}`, status: "pending", result: null }));
    const state: any = {
      view: "inbox", data: { inbox: items }, bulkMode: true, bulkSelected: new Set([1, 2, 3]),
      bulkRetryItems: new Map(), bulkRouteKeys: new Map(), bulkSubmitting: false, bulkError: "",
    };
    const els = Object.fromEntries([
      "bulkModeButton", "bulkToolbar", "bulkSelectionCount", "bulkSelectAll", "bulkApplyButton",
      "bulkCancelButton", "bulkStatusSelect", "bulkRevisitField", "bulkRevisitOn", "bulkError",
    ].map((key) => [key, { value: key === "bulkStatusSelect" ? (mode === "route" ? "route:archive" : "done") : "" }]));
    const routed: Array<{ id: number; expected: any; key: string }> = [];
    const patched: any[] = [];
    const toasts: string[] = [];
    let refreshes = 0;
    let secondPages = 0;
    let sequence = 0;
    const loadDashboard = async () => {
      refreshes++;
      // The committed result and retry snapshot must exist before any list request.
      assert.deepEqual(state.bulkResult.updated, refreshes === 1 ? [1, 3] : [2]);
      assert.deepEqual([...state.bulkSelected], refreshes === 1 ? [2] : []);
      if (refreshes === 1) {
        assert.equal(state.bulkRetryItems.get(2).content, "Original 2");
        items[1].content = "Mutated original object";
      }
      state.data.inbox = [{ ...items[1], content: "Fresh page content" }];
      return true;
    };
    const loadAllIdeaItems = async () => {
      secondPages++;
      throw new Error("second page offline");
    };
    const routeInboxViaApi = async (id: number, _destination: string, body: any, key: string) => {
      routed.push({ id, expected: body.expected, key });
      if (id === 2 && routed.filter((item) => item.id === 2).length === 1) throw new Error("conflict");
    };
    const fetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      patched.push(body);
      return Response.json(patched.length === 1
        ? { updated: [1, 3], failed: [{ id: 2, error: "conflict" }] }
        : { updated: [2], failed: [] }, { status: patched.length === 1 ? 207 : 200 });
    };
    const harness = new Function(
      "state", "els", "readApiJson", "mapConcurrent", "BULK_ROUTE_KEYS", "DEFER_ROUTE", "WISH_ROUTE",
      "inboxQuickRoutes", "loadDashboard", "loadAllIdeaItems", "inboxExpected", "routeInboxViaApi",
      "defaultRevisitDate", "showToast", "todayInTokyo", "currentItems", "renderList", "statusLabel",
      "window", "crypto", "fetch", `${source}; return {applyInboxBulkUpdate};`,
    )(
      state, els, (response: Response) => response.json(), browserQueue, ["archive"], "defer", "wish",
      { archive: { label: "Archive", destination: "archive", intent: "do" } }, loadDashboard, loadAllIdeaItems,
      (item: any) => ({ content: item.content, status: item.status, result: item.result }), routeInboxViaApi,
      () => "2026-10-27", (message: string) => toasts.push(message), () => "2026-10-26",
      () => state.data.inbox, () => {}, () => "Done", { confirm: () => true },
      { randomUUID: () => `request-${++sequence}` }, fetch,
    );
    await harness.applyInboxBulkUpdate();
    assert.equal(state.bulkSubmitting, false);
    assert.equal(state.bulkMode, true);
    assert.deepEqual([...state.bulkSelected], [2]);
    assert.equal(state.bulkRetryItems.get(2).content, "Original 2");
    assert.deepEqual(state.bulkResult.updated, [1, 3]);
    assert.deepEqual(state.bulkResult.failed.map((item: any) => item.id), [2]);
    assert.match(state.bulkError, /2件.*1件/u);
    assert.match(state.bulkError, /一覧の再読み込みに失敗/u);
    assert.match(toasts[0], /操作結果と再試行対象は保持/u);
    assert.equal(secondPages, 1);

    await harness.applyInboxBulkUpdate();
    assert.deepEqual(state.bulkResult.updated, [2]);
    assert.deepEqual([...state.bulkSelected], []);
    assert.equal(state.bulkRetryItems.size, 0);
    if (mode === "route") {
      assert.deepEqual(routed.map((item) => item.id), [1, 2, 3, 2]);
      assert.equal(routed[3].expected.content, "Original 2");
      assert.equal(routed[3].key, routed[1].key);
    } else {
      assert.deepEqual(patched[1].items, [{ id: 2, original: { content: "Original 2", status: "pending", result: null } }]);
    }
  }
});

test("C16: targeted Habit snapshot matches full normalization for today/past/skip/cancel and visible history", async () => {
  const original = globalThis.fetch;
  const now = new Date("2026-10-26T03:00:00Z");
  const habit = {
    id: 1,
    name: "Daily",
    purpose: null,
    cadence: "daily",
    status: "active",
    started_on: "2026-01-01",
    target_per_week: 1,
    created_at: stamp,
    updated_at: stamp,
  };
  try {
    for (const rows of [
      [],
      [
        {
          id: 1,
          habit_id: 1,
          practiced_on: "2026-10-26",
          kind: "done",
          note: "memo",
          created_at: stamp,
        },
      ],
      [
        {
          id: 1,
          habit_id: 1,
          practiced_on: "2026-10-25",
          kind: "skip",
          note: "rest",
          created_at: stamp,
        },
      ],
    ]) {
      const calls: URL[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        return Response.json(url.pathname.endsWith("/habits") ? [habit] : rows);
      };
      const query = { period: "week" as const, anchor: "2026-10-26" };
      const result = await loadHabitMutationResult(env, 1, query, now);
      assert.deepEqual(result.habit, normalizeHabits([habit], rows, now).habits[0]);
      assert.deepEqual(result.history, normalizeHabitHistory([habit], rows, query, now));
      assert.equal(calls.length, 2);
      assert.equal(calls[0].searchParams.get("id"), "eq.1");
      assert.equal(calls[1].searchParams.get("habit_id"), "eq.1");
      assert.match(calls[1].searchParams.get("or") || "", /practiced_on.gte.2026-10-19/);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("C16: late week save preserves month navigation and refreshes a history read that predates the save", async () => {
  const source = await readFile(new URL("../public/habits.js", import.meta.url), "utf8");
  const historySource = source.slice(
    source.indexOf("async function loadHistory()"),
    source.indexOf("\nfunction habitLogUrl()"),
  );
  const updateSource = source.slice(
    source.indexOf("function applyHabitUpdate("),
    source.indexOf("\nfunction renderManage("),
  );
  const state = {
    data: {
      today: "2026-10-26",
      weekStart: "2026-10-26",
      habits: [
        { id: 1, status: "active", cadence: "daily", eligibleToday: true, completedToday: false },
      ],
      summary: { completedToday: 0, remainingToday: 1 },
      lastWeek: { habits: [] },
    },
    history: {
      period: "month",
      anchor: null,
      loading: false,
      data: { period: "week", anchor: "2026-10-26", habits: [] },
    },
  };
  let release!: (value: Response) => void;
  let requests = 0;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fakeFetch = async () =>
    ++requests === 1
      ? held
      : Response.json({
          period: "month",
          anchor: "2026-10",
          habits: [{ id: 1, updatedAfterSave: true }],
        });
  const els = {
    historyPrev: { disabled: false },
    historyNext: { disabled: false },
    historyStatus: { hidden: false, textContent: "" },
  };
  const harness = new Function(
    "state",
    "els",
    "fetch",
    "readApiJson",
    "renderHistory",
    "render",
    "showToast",
    "URLSearchParams",
    `let historyLoadGeneration=0; let habitMutationVersion=0; ${historySource}; ${updateSource}; return {loadHistory,applyHabitUpdate};`,
  )(
    state,
    els,
    fakeFetch,
    (response: Response) => response.json(),
    () => {},
    () => {},
    () => {},
    URLSearchParams,
  );
  const loading = harness.loadHistory();
  harness.applyHabitUpdate({
    update: {
      today: "2026-10-26",
      habit: { ...state.data.habits[0], completedToday: true },
      lastWeek: null,
      history: { period: "week", anchor: "2026-10-26", habits: [{ id: 1 }] },
    },
  });
  assert.equal(state.history.loading, true);
  release(
    Response.json({
      period: "month",
      anchor: "2026-10",
      habits: [{ id: 1, updatedAfterSave: false }],
    }),
  );
  await loading;
  await tick(5);
  assert.equal(state.history.data.period, "month");
  assert.equal(state.history.loading, false);
  assert.equal(
    (state.history.data.habits[0] as { updatedAfterSave: boolean }).updatedAfterSave,
    true,
  );
  assert.equal(requests, 2);
});
