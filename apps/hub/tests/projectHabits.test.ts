import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProjectHabits,
  readProjectHabitInput,
  readProjectHabitQuery,
} from "../functions/_shared/projectHabits.ts";
import { onRequest } from "../functions/api/project-habits.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
const stamp = "2026-10-27T01:02:03.123456+00:00";
const now = new Date("2026-10-27T03:00:00Z");
const habit = {
  id: 7,
  source_want_id: null,
  name: "運動",
  purpose: "体力をつける",
  cadence: "weekly",
  status: "active",
  started_on: "2026-10-01",
  target_per_week: 3,
  created_at: stamp,
  updated_at: stamp,
};
const input = {
  projectId: 1,
  projectUpdatedAt: stamp,
  habitId: 7,
  habitUpdatedAt: stamp,
  relationUpdatedAt: null,
};
function request(method: string, body: unknown = input, extra: Record<string, string> = {}) {
  return new Request("https://hub.example/api/project-habits", {
    method,
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "project-habit-link",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
function log(id: number, date: string, kind = "done") {
  return {
    id,
    habit_id: 7,
    practiced_on: date,
    kind,
    note: "記録",
    created_at: `${date}T03:00:00Z`,
  };
}
function installReads(
  options: { missing?: boolean; fail?: string; links?: boolean; projectStatus?: string } = {},
) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (resource, init) => {
    const url = new URL(String(resource));
    calls.push(url.pathname);
    assert.equal(init?.method ?? "GET", "GET");
    if (options.fail && url.pathname.endsWith(`/${options.fail}`))
      return new Response("Unavailable", { status: 503 });
    if (url.pathname.endsWith("/projects"))
      return Response.json([
        {
          id: Number(url.searchParams.get("id")!.slice(3)),
          updated_at: stamp,
          status: options.projectStatus ?? "active",
        },
      ]);
    if (url.pathname.endsWith("/project_habits"))
      return Response.json([
        {
          project_id: Number(url.searchParams.get("project_id")!.slice(3)),
          habit_id: 7,
          linked: options.links !== false,
          created_at: stamp,
          updated_at: stamp,
        },
      ]);
    if (url.pathname.endsWith("/habits"))
      return Response.json(
        options.missing
          ? []
          : [
              habit,
              { ...habit, id: 8, status: "paused", cadence: "daily" },
              { ...habit, id: 9, status: "archived" },
            ],
      );
    if (url.pathname.endsWith("/habit_logs"))
      return Response.json([
        log(1, "2026-10-26"),
        log(2, "2026-10-27", "skip"),
        log(3, "2026-10-25"),
      ]);
    throw new Error(`Unexpected ${url.pathname}`);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("Habit link input requires both original snapshots and preserves fractional seconds", async () => {
  const result = await readProjectHabitInput(request("POST"));
  assert.deepEqual(result, { ok: true, value: input });
  for (const value of [
    { ...input, unknown: true },
    { ...input, habitUpdatedAt: null },
    { ...input, habitId: "7" },
    { ...input, projectId: 0 },
    { ...input, habitUpdatedAt: "today" },
  ]) {
    assert.equal((await readProjectHabitInput(request("POST", value))).ok, false);
  }
  assert.equal(
    (await readProjectHabitInput(request("POST", { ...input, extra: "x".repeat(8000) }))).ok,
    false,
  );
});

test("Habit lookup requires one valid projectId", () => {
  for (const query of [
    "",
    "?projectId=1&projectId=2",
    "?projectId=0",
    "?projectId=01",
    "?projectId=1&unknown=x",
    "?projectId=9007199254740992",
  ]) {
    assert.equal(
      readProjectHabitQuery(new Request(`https://hub.example/api/project-habits${query}`)).ok,
      false,
    );
  }
  assert.deepEqual(
    readProjectHabitQuery(new Request("https://hub.example/api/project-habits?projectId=1")),
    { ok: true, value: 1 },
  );
});

test("Project lookup returns canonical status and rejects unknown status", async () => {
  for (const projectStatus of ["active", "waiting", "on_hold", "completed", "dropped"]) {
    const mock = installReads({ projectStatus });
    try {
      const result = await loadProjectHabits(env, 1, now);
      assert.equal(result.projectStatus, projectStatus);
      assert.equal(result.projectUpdatedAt, stamp);
    } finally {
      mock.restore();
    }
  }
  const mock = installReads({ projectStatus: "unknown" });
  try {
    await assert.rejects(() => loadProjectHabits(env, 1, now), /Project returned invalid data/);
  } finally {
    mock.restore();
  }
});

test("Projects projects the canonical weekly count, skip, history and paused/archive state", async () => {
  const mock = installReads();
  try {
    const result = await loadProjectHabits(env, 1, now);
    assert.equal(result.projectUpdatedAt, stamp);
    assert.equal(result.links[0].state, "available");
    const linked = result.links[0].habit!;
    assert.equal(linked.cadence, "weekly");
    assert.equal(linked.targetPerWeek, 3);
    assert.equal(linked.weeklyCount, 1);
    assert.equal(linked.completedThisWeek, false);
    assert.equal(linked.skippedThisWeek, true);
    assert.equal(linked.skippedToday, true);
    assert.equal(linked.history.find((day) => day.date === "2026-10-26")?.note, "記録");
    assert.equal(result.habits.find((item) => item.id === 8)?.status, "paused");
    assert.equal(result.habits.find((item) => item.id === 9)?.status, "archived");
    // The same Habit can support another Project without combining executions.
    const second = await loadProjectHabits(env, 2, now);
    assert.equal(second.links[0].habit?.id, linked.id);
    assert.equal(second.links[0].habit?.weeklyCount, 1);
    assert.ok(mock.calls.every((path) => !path.includes("action") && !path.includes("rpc")));
  } finally {
    mock.restore();
  }
});

test("Missing referenced Habit is explicit; acquisition errors never become zero executions", async () => {
  const mock = installReads({ missing: true });
  try {
    const result = await loadProjectHabits(env, 1, now);
    assert.deepEqual(result.links, [
      {
        habitId: 7,
        linkedAt: stamp,
        linked: true,
        updatedAt: stamp,
        state: "missing",
        habit: null,
      },
    ]);
  } finally {
    mock.restore();
  }
  for (const fail of ["project_habits", "habits", "habit_logs"]) {
    const broken = installReads({ fail });
    try {
      const response = await onRequest({
        request: new Request("https://hub.example/api/project-habits?projectId=1"),
        env,
      });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.ok(body.error);
      assert.equal(body.links, undefined);
    } finally {
      broken.restore();
    }
  }
});

test("Unlinked reload returns no relationship while preserving existing Habit candidates", async () => {
  const mock = installReads({ links: false });
  try {
    const result = await loadProjectHabits(env, 1, now);
    assert.deepEqual(result.links, []);
    assert.equal(result.habits[0].id, 7);
    assert.equal(result.habits[0].weeklyCount, 1);
    assert.deepEqual(result.relations, [{ habitId: 7, linked: false, updatedAt: stamp }]);
  } finally {
    mock.restore();
  }
});

test("Link and unlink call only their atomic RPC, with no logs or Action mutation", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (resource, init) => {
    paths.push(new URL(String(resource)).pathname);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { p_request: input });
    return Response.json(1);
  };
  try {
    for (const method of ["POST", "POST", "DELETE", "DELETE"]) {
      const response = await onRequest({ request: request(method), env });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        projectId: 1,
        habitId: 7,
        linked: method === "POST",
      });
    }
    assert.deepEqual(paths, [
      "/rest/v1/rpc/link_project_habit",
      "/rest/v1/rpc/link_project_habit",
      "/rest/v1/rpc/unlink_project_habit",
      "/rest/v1/rpc/unlink_project_habit",
    ]);
    for (const headers of [
      { Origin: "https://other.example" },
      { "X-Dashboard-Action": "wrong" },
      { "Content-Type": "text/plain" },
    ] as Record<string, string>[]) {
      assert.ok((await onRequest({ request: request("POST", input, headers), env })).status >= 400);
    }
    assert.equal(paths.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("Stale Project/Habit snapshots return 409; unexpected RPC result is rejected", async () => {
  const original = globalThis.fetch;
  try {
    for (const code of [
      "PROJECT_CONFLICT",
      "HABIT_CONFLICT",
      "PROJECT_HABIT_CONFLICT",
      "PROJECT_NOT_OPEN",
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: code }), { status: 400 });
      const response = await onRequest({ request: request("POST"), env });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, code);
    }
    globalThis.fetch = async () => Response.json(2);
    assert.equal((await onRequest({ request: request("DELETE"), env })).status, 502);
  } finally {
    globalThis.fetch = original;
  }
});

test("Habit relations paginate beyond 1000 rows without truncating or duplicating links", async () => {
  const original = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async (resource) => {
    const url = new URL(String(resource));
    if (url.pathname.endsWith("/projects"))
      return Response.json([{ id: 1, updated_at: stamp, status: "active" }]);
    if (url.pathname.endsWith("/habits") || url.pathname.endsWith("/habit_logs"))
      return Response.json([]);
    if (url.pathname.endsWith("/project_habits")) {
      const offset = url.searchParams.get("offset")!;
      offsets.push(offset);
      return Response.json(
        offset === "0"
          ? Array.from({ length: 1000 }, (_, index) => ({
              project_id: 1,
              habit_id: index + 1,
              linked: true,
              created_at: stamp,
              updated_at: stamp,
            }))
          : [{ project_id: 1, habit_id: 1001, linked: true, created_at: stamp, updated_at: stamp }],
      );
    }
    throw new Error(`Unexpected ${url.pathname}`);
  };
  try {
    assert.equal((await loadProjectHabits(env, 1, now)).links.length, 1001);
    assert.deepEqual(offsets, ["0", "1000"]);
  } finally {
    globalThis.fetch = original;
  }
});
