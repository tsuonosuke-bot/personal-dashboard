import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
// Browser controller is syntax-checked by check:client. These tests execute its
// DOM-free state boundary without importing a DOM shim or adding a dependency.
const modulePath = "../public/projects/habits.js";
const {
  createProjectHabitsModel,
  habitProgress,
  habitSourceUrl,
  projectHabitSnapshot,
  readProjectHabitsPayload,
} = await import(modulePath);
const stamp = "2026-10-27T01:02:03.123456+00:00";
const nextStamp = "2026-10-27T01:03:03.654321+00:00";
const project = { id: 1, title: "大会に向けて体力をつける", status: "active", updatedAt: stamp };
const habit = {
  id: 7,
  name: "運動",
  cadence: "weekly",
  status: "active",
  updatedAt: stamp,
  targetPerWeek: 3,
  weeklyCount: 1,
  completedToday: false,
  skippedToday: true,
  skippedThisWeek: true,
};
function payload(linked = false, token: string | null = null) {
  return {
    projectId: 1,
    projectUpdatedAt: stamp,
    source: { state: "live" },
    habits: [{ ...habit }],
    links: linked
      ? [{ habitId: 7, updatedAt: token || stamp, state: "available", habit: { ...habit } }]
      : [],
    relations: token ? [{ habitId: 7, linked, updatedAt: token }] : [],
  };
}

test("Habit UI uses canonical weekly target/skip/count and a Project return route", () => {
  assert.equal(habitProgress(habit), "今週 1/3回 · 今日 休み · 今週の休みあり");
  assert.equal(
    habitProgress({ ...habit, cadence: "daily", completedToday: true, skippedToday: false }),
    "今週 1回 · 今日 実施済み",
  );
  assert.equal(habitSourceUrl(1, 7), "/habits/?projectId=1&habitId=7");
  assert.deepEqual(projectHabitSnapshot(payload(false, stamp), 7), {
    projectId: 1,
    projectUpdatedAt: stamp,
    habitId: 7,
    habitUpdatedAt: stamp,
    relationUpdatedAt: stamp,
  });
});

test("Missing references remain unknown; malformed summaries/relations cannot turn into zero", () => {
  const missing = payload(true, stamp);
  const data = {
    ...missing,
    habits: [],
    links: [{ habitId: 7, updatedAt: stamp, state: "missing", habit: null }],
  };
  assert.equal(readProjectHabitsPayload(data, 1).links[0].habit, null);
  assert.throws(() => readProjectHabitsPayload({ ...data, source: { state: "error" } }, 1));
  assert.throws(() =>
    readProjectHabitsPayload({ ...payload(), habits: [{ ...habit, weeklyCount: null }] }, 1),
  );
  assert.throws(() => readProjectHabitsPayload({ ...missing, relations: [] }, 1));
  assert.throws(() =>
    readProjectHabitsPayload({ ...missing, links: [...missing.links, ...missing.links] }, 1),
  );
});

test("Loading only reads; acquisition errors retain selection and expose retry state", async () => {
  const methods: string[] = [];
  let fail = false;
  const model = createProjectHabitsModel({
    project,
    request: async (method: string) => {
      methods.push(method);
      if (fail) throw new Error("習慣を取得できません");
      return payload();
    },
  });
  await model.reload();
  model.select(7);
  fail = true;
  await model.reload();
  assert.equal(model.state.selectedId, 7);
  assert.equal(model.state.data, null);
  assert.equal(model.state.needsReload, true);
  assert.match(model.state.error, /取得できません/);
  assert.deepEqual(methods, ["GET", "GET"]);
  assert.equal(await model.changeLink(7, true), false);
  assert.equal(methods.length, 2);
});

test("Explicit link uses tombstone CAS, refreshes source and Project, then clears selection", async () => {
  const calls: Array<{ method: string; body: unknown }> = [];
  let linked = false;
  let refreshes = 0;
  const toasts: string[] = [];
  const model = createProjectHabitsModel({
    project,
    refreshProject: async (projectId: number) => {
      assert.equal(projectId, project.id);
      refreshes++;
    },
    showToast: (message: string) => toasts.push(message),
    request: async (method: string, _id: number, body: unknown) => {
      calls.push({ method, body });
      if (method === "GET") return payload(linked, linked ? nextStamp : stamp);
      linked = true;
      return { projectId: 1, habitId: 7, linked };
    },
  });
  await model.reload();
  model.select(7);
  assert.equal(await model.changeLink(7, true), true);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST", "GET"],
  );
  assert.equal((calls[1].body as { relationUpdatedAt: string }).relationUpdatedAt, stamp);
  assert.equal(refreshes, 1);
  assert.equal(model.state.selectedId, null);
  assert.equal(model.state.data.links[0].habit.weeklyCount, 1);
  assert.equal(toasts.length, 1);
});

test("Conflict refreshes snapshots only after explicit reload and never replays a stale operation", async () => {
  const calls: Array<{ method: string; token?: string }> = [];
  let reads = 0;
  let fail = true;
  const model = createProjectHabitsModel({
    project,
    request: async (method: string, _id: number, body: { relationUpdatedAt: string }) => {
      calls.push({ method, token: body?.relationUpdatedAt });
      if (method === "GET") return payload(false, reads++ ? nextStamp : stamp);
      if (fail) throw new Error("関連が変更されました");
      return { projectId: 1, habitId: 7, linked: true };
    },
  });
  await model.reload();
  model.select(7);
  assert.equal(await model.changeLink(7, true), false);
  assert.equal(model.state.selectedId, 7);
  assert.equal(model.state.needsReload, true);
  assert.equal(await model.changeLink(7, true), false);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST"],
  );
  await model.reload();
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST", "GET"],
  );
  assert.equal(model.state.selectedId, 7);
  fail = false;
  await model.changeLink(7, true);
  assert.equal(calls[3].token, nextStamp);
});

test("Saved mutation and failed source refresh are distinct from an unsaved mutation", async () => {
  let reads = 0;
  let failRead = true;
  let refreshes = 0;
  const calls: string[] = [];
  const model = createProjectHabitsModel({
    project,
    refreshProject: async () => {
      refreshes++;
    },
    request: async (method: string) => {
      calls.push(method);
      if (method === "GET") {
        if (reads++ && failRead) throw new Error("offline");
        return payload(true, nextStamp);
      }
      return { projectId: 1, habitId: 7, linked: true };
    },
  });
  await model.reload();
  model.select(7);
  assert.equal(await model.changeLink(7, true), true);
  assert.match(model.state.error, /保存済み/);
  assert.equal(model.state.needsReload, true);
  assert.equal(model.state.data, null);
  assert.equal(refreshes, 0);
  failRead = false;
  await model.reload();
  assert.equal(refreshes, 1);
  assert.equal(model.state.needsReload, false);
  assert.deepEqual(calls, ["GET", "POST", "GET", "GET"]);
});

test("Parent refresh failure keeps known saved result and reload never duplicates mutation", async () => {
  let fail = true;
  let writes = 0;
  const model = createProjectHabitsModel({
    project,
    refreshProject: async () => {
      if (fail) throw new Error("project offline");
    },
    request: async (method: string) => {
      if (method === "GET") return payload(true, stamp);
      writes++;
      return { projectId: 1, habitId: 7, linked: false };
    },
  });
  await model.reload();
  assert.equal(await model.changeLink(7, false), true);
  assert.match(model.state.error, /保存済み/);
  fail = false;
  await model.reload();
  assert.equal(writes, 1);
  assert.equal(model.state.needsReload, false);
});

test("Unknown mutation outcome refreshes parent after explicit GET without claiming saved or replaying", async () => {
  let linked = false;
  let parentRefreshes = 0;
  const methods: string[] = [];
  const model = createProjectHabitsModel({
    project,
    refreshProject: async () => {
      parentRefreshes++;
    },
    request: async (method: string) => {
      methods.push(method);
      if (method === "GET") return payload(linked, linked ? nextStamp : stamp);
      linked = true;
      throw new Error("応答を受信できませんでした");
    },
  });
  await model.reload();
  model.select(7);
  assert.equal(await model.changeLink(7, true), false);
  assert.doesNotMatch(model.state.error, /保存済み/);
  assert.equal(parentRefreshes, 0);
  await model.reload();
  assert.equal(parentRefreshes, 1);
  assert.equal(model.state.data.links[0].habitId, 7);
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
});

test("Canonical terminal Project status from GET overrides the originally active detail", async () => {
  const methods: string[] = [];
  const model = createProjectHabitsModel({
    project,
    request: async (method: string) => {
      methods.push(method);
      return method === "GET"
        ? { ...payload(true, stamp), projectStatus: "dropped" }
        : { projectId: 1, habitId: 7, linked: false };
    },
  });
  await model.reload();
  assert.equal(model.terminal(), true);
  assert.equal(await model.changeLink(7, true), false);
  assert.equal(await model.changeLink(7, false), true);
  assert.deepEqual(methods, ["GET", "DELETE", "GET"]);
});

test("Double submission is blocked; terminal Project permits reads/unlink only", async () => {
  let finish: (value: unknown) => void = () => {};
  const methods: string[] = [];
  const model = createProjectHabitsModel({
    project,
    request: async (method: string) => {
      methods.push(method);
      if (method === "GET") return payload(false, stamp);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await model.reload();
  const pending = model.changeLink(7, true);
  assert.equal(await model.changeLink(7, true), false);
  finish({ projectId: 1, habitId: 7, linked: true });
  await pending;
  assert.equal(methods.filter((method) => method === "POST").length, 1);
  const terminalMethods: string[] = [];
  const terminal = createProjectHabitsModel({
    project: { ...project, status: "completed" },
    request: async (method: string) => {
      terminalMethods.push(method);
      return method === "GET" ? payload(true, stamp) : { projectId: 1, habitId: 7, linked: false };
    },
  });
  await terminal.reload();
  assert.equal(await terminal.changeLink(7, true), false);
  assert.equal(await terminal.changeLink(7, false), true);
  assert.deepEqual(terminalMethods, ["GET", "DELETE", "GET"]);
});

test("Dialog uses native modal, escaped names, explicit unlink effects and Habits routes", async () => {
  const source = await readFile(new URL("../public/projects/habits.js", import.meta.url), "utf8");
  assert.match(source, /createElement\("dialog"\)/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /習慣と実施履歴、ほかの目標との関連は残ります/);
  assert.match(source, /escapeHtml\(link\.habit\.name\)/);
  assert.match(source, /habitSourceUrl\(project\.id, link\.habitId\)/);
  assert.match(source, /取得できません。関連を確認/);
});
