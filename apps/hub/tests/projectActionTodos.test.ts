import assert from "node:assert/strict";
import test from "node:test";
import { actionStatusForTodo, actionTodoId, linkedProjectAction, validNextActionResolution, readProjectTodoLinkInput } from "../functions/_shared/projectActionTodos.ts";
import { loadProjects, readProjectActionResolveInput, readProjectActionUpdateInput, updateProjectAction } from "../functions/_shared/projects.ts";
import { listScheduledActions } from "../functions/_shared/scheduledActions.ts";
import { onRequest as linkEndpoint } from "../functions/api/project-action-todos.ts";
import { onRequest as todoEndpoint } from "../functions/api/scheduled-actions.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
const stamp = "2026-10-23T01:02:03.123456+00:00";
const schedule = { allDay: false, date: "2026-10-24", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" };
const project = { id: 1, title: "試験", outcome: "受験する", theme: null, status: "active", target_on: null, review_on: null,
  waiting_for: null, completed_at: null, created_at: stamp, updated_at: stamp };
const action = { id: 11, project_id: 1, project_item_id: null, milestone_id: null, content: "申し込む", status: "next",
  due_on: "2026-11-30", start_on: "2026-11-01", sort_order: null, waiting_for: null, completed_at: null, created_at: stamp, updated_at: stamp };
const todo = { id: 7, source_route_id: null, google_event_id: "event-1", calendar_title: "申込手続き", calendar_url: null, calendar_etag: '"etag"',
  calendar_state: "confirmed", current_schedule: schedule, status: "pending", completed_at: null, note: null, reschedule_count: 0,
  last_calendar_sync_at: stamp, created_at: stamp, updated_at: stamp };
const linkInput = { actionId: 11, actionUpdatedAt: stamp, todoId: 7, todoUpdatedAt: stamp, todoStatus: "pending" };
const resolution = { resolution: "continue", nextActionId: null, nextActionContent: "受験票を確認する", waitingFor: null, reviewOn: null };
function request(path: string, method: string, body: unknown, header = "project-todo-link") {
  return new Request(`https://hub.example${path}`, { method, headers: { Origin: "https://hub.example", "Content-Type": "application/json", "X-Dashboard-Action": header }, body: JSON.stringify(body) });
}

test("ToDo実行状態の全15組を対応付け、pendingのNext/順序/待機を保持する", () => {
  for (const status of ["next", "queued", "waiting", "done", "cancelled"]) {
    assert.equal(actionStatusForTodo("completed", status), "done");
    assert.equal(actionStatusForTodo("skipped", status), "cancelled");
    assert.equal(actionStatusForTodo("pending", status), ["done", "cancelled"].includes(status) ? "queued" : status);
  }
});

test("Next終了の4分岐は同じ検証を使い、不足・不要な副入力・不正日付を拒否する", () => {
  assert.equal(validNextActionResolution(resolution), true);
  assert.equal(validNextActionResolution({ ...resolution, nextActionId: 12, nextActionContent: null }), true);
  assert.equal(validNextActionResolution({ ...resolution, resolution: "complete", nextActionContent: null }), true);
  assert.equal(validNextActionResolution({ ...resolution, resolution: "waiting", nextActionContent: null, waitingFor: "返信", reviewOn: "2026-10-30" }), true);
  assert.equal(validNextActionResolution({ ...resolution, resolution: "on_hold", nextActionContent: null, reviewOn: "2026-10-30" }), true);
  for (const invalid of [
    { ...resolution, nextActionContent: null }, { ...resolution, nextActionId: 12 },
    { ...resolution, resolution: "complete" }, { ...resolution, unknown: true },
    { ...resolution, resolution: "waiting", nextActionContent: null, waitingFor: "返信", reviewOn: "2026-02-30" },
  ]) assert.equal(validNextActionResolution(invalid), false);
});

test("one-to-oneのobject/nullと旧array応答を読み、複数リンクは拒否する", () => {
  assert.equal(actionTodoId({ project_action_todos: { scheduled_action_id: 7 } }), 7);
  assert.equal(actionTodoId({ project_action_todos: [{ scheduled_action_id: 7 }] }), 7);
  assert.equal(actionTodoId({ project_action_todos: null }), null);
  assert.throws(() => actionTodoId({ project_action_todos: [{ scheduled_action_id: 7 }, { scheduled_action_id: 8 }] }), /Multiple/);
  const nested = { project_action_id: 11, project_actions: { ...action, projects: project } };
  const parsed = linkedProjectAction({ project_action_todos: nested });
  assert.equal(parsed?.updatedAt, stamp);
  assert.equal(parsed?.storedDueOn, "2026-11-30");
  assert.deepEqual(linkedProjectAction({ project_action_todos: [nested] }), parsed);
  assert.throws(() => linkedProjectAction({ project_action_todos: { project_actions: { ...action, projects: null } } }), /Invalid/);
});

test("リンク/解除入力は両snapshotの小数秒を保持し、未知キーや解除での状態変更を拒否する", async () => {
  const parsed = await readProjectTodoLinkInput(request("/api/project-action-todos", "POST", { ...linkInput, resolution }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.todoUpdatedAt, stamp);
  assert.equal((await readProjectTodoLinkInput(request("/api/project-action-todos", "POST", { ...linkInput, unexpected: true }))).ok, false);
  assert.equal((await readProjectTodoLinkInput(request("/api/project-action-todos", "DELETE", { ...linkInput, resolution }))).ok, false);
});

test("紐づけAPIは単一RPCだけを呼び、Calendarや新しいAction/ToDoは作らない", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { p_request: { ...linkInput, resolution: null } });
    return Response.json(1);
  };
  try {
    const response = await linkEndpoint({ request: request("/api/project-action-todos", "POST", { ...linkInput, resolution: null }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projectId: 1, linked: true });
    assert.deepEqual(paths, ["/rest/v1/rpc/link_project_action_todo"]);
    const blocked = await linkEndpoint({ request: request("/api/project-action-todos", "POST", linkInput, "wrong"), env });
    assert.equal(blocked.status, 403);
    assert.equal(paths.length, 1);
  } finally { globalThis.fetch = original; }
});

test("Project読込はToDoの実効日付をNext/Actionへ投影し、独立日付を上書きしない", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/projects")) return Response.json([project]);
    if (path.endsWith("/project_actions")) return Response.json([{ ...action, project_action_todos: { scheduled_action_id: 7 } }]);
    if (path.endsWith("/project_items") || path.endsWith("/project_milestones") || path.endsWith("/want_routes") || path.endsWith("/wants")) return Response.json([]);
    if (path.endsWith("/scheduled_actions")) return Response.json([{ ...todo, project_action_todos: { project_action_id: 11, project_actions: { ...action, projects: project } } }]);
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const result = await loadProjects(env);
    const next = result.projects[0].nextAction!;
    assert.equal(next.startOn, schedule.date);
    assert.equal(next.dueOn, schedule.date);
    assert.equal(next.storedStartOn, action.start_on);
    assert.equal(next.storedDueOn, action.due_on);
    assert.equal(result.projects[0].actions[0].linkedTodo?.linkedProjectAction?.projectId, 1);
    assert.equal(next.linkedTodo?.updatedAt, stamp);
  } finally { globalThis.fetch = original; }
});

test("候補のToDo一覧は1000件を超えて全ページ取得する", async () => {
  const original = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/scheduled_actions")) {
      offsets.push(url.searchParams.get("offset")!);
      return Response.json(url.searchParams.get("offset") === "0"
        ? Array.from({ length: 1000 }, (_, i) => ({ ...todo, id: i + 1 })) : [{ ...todo, id: 1001 }]);
    }
    if (url.pathname.endsWith("/want_routes") || url.pathname.endsWith("/wants")) return Response.json([]);
    throw new Error(`Unexpected ${url.pathname}`);
  };
  try { assert.equal((await listScheduledActions(env)).items.length, 1001); assert.deepEqual(offsets, ["0", "1000"]); }
  finally { globalThis.fetch = original; }
});

test("ToDoからのNext完了は両snapshot/resolutionを単一RPCへ渡しCalendarを呼ばない", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path.endsWith("/scheduled_actions")) return Response.json([todo]);
    if (path.endsWith("/rpc/update_linked_todo")) {
      const body = JSON.parse(String(init?.body)).p_request;
      assert.equal(body.actionId, 11); assert.equal(body.actionUpdatedAt, stamp);
      assert.deepEqual(body.resolution, resolution);
      return Response.json({ id: 7, status: "completed", completedAt: stamp, note: "済", updatedAt: stamp });
    }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const response = await todoEndpoint({ request: request("/api/scheduled-actions", "PATCH", { id: 7, command: "complete", note: "済", schedule: null,
      original: { status: "pending", updatedAt: stamp, calendarEtag: null, schedule }, projectAction: { id: 11, updatedAt: stamp }, resolution }, "scheduled-todo-update"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["/rest/v1/scheduled_actions", "/rest/v1/rpc/update_linked_todo"]);
  } finally { globalThis.fetch = original; }
});

test("古いリンクsnapshotと旧Projectクライアントの抜け道を409として返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "TODO_SNAPSHOT_REQUIRED" }), { status: 400 });
  try {
    await assert.rejects(() => updateProjectAction(env, { actionId: 11, originalUpdatedAt: stamp, operation: "complete", content: null, startOn: null, dueOn: null, milestoneId: null }), (error: unknown) => (error as { status: number }).status === 409);
    const response = await linkEndpoint({ request: request("/api/project-action-todos", "DELETE", linkInput), env });
    assert.equal(response.status, 409);
  } finally { globalThis.fetch = original; }
});

test("Projectの既存入力契約はoptional Todo snapshot/Next見送りを検証して保持する", async () => {
  const todoSnapshot = { id: 7, updatedAt: stamp, status: "pending" };
  const resolved = await readProjectActionResolveInput(request("/api/project-actions", "PATCH", { actionId: 11, originalUpdatedAt: stamp, ...resolution, terminal: "cancelled", todo: todoSnapshot }));
  assert.equal(resolved.ok && resolved.value.terminal, "cancelled");
  const update = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", { actionId: 11, originalUpdatedAt: stamp, operation: "complete", content: null, startOn: null, dueOn: null, todo: todoSnapshot }));
  assert.equal(update.ok && update.value.todo?.updatedAt, stamp);
  const invalid = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", { actionId: 11, originalUpdatedAt: stamp, operation: "complete", content: null, startOn: null, dueOn: null, todo: { ...todoSnapshot, unknown: true } }));
  assert.equal(invalid.ok, false);
});
