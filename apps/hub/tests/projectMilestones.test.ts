import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createProjectAction,
  normalizeProjects,
  publicProjectError,
  readProjectActionCreateInput,
  readProjectActionUpdateInput,
  readProjectMilestoneUpdateInput,
  updateProjectMilestone,
} from "../functions/_shared/projects.ts";
import { onRequest as milestonesRoute } from "../functions/api/project-milestones.ts";
import { renderProjectSection } from "../public/today-panel.js";

// #161: マイルストンで道筋を表し、タスクを改行区切りでまとめて追加できる。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
const stamp = "2026-10-10T01:02:03.123456+00:00";

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "英語を話せるようにする", outcome: "10分の雑談ができる", theme: null, status: "active",
    target_on: "2026-12-31", review_on: null, waiting_for: null, completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: stamp, ...overrides,
  };
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, project_id: 1, project_item_id: null, milestone_id: null, content: "教材を決める", status: "queued",
    due_on: null, start_on: null, sort_order: 1, waiting_for: null, completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: stamp, ...overrides,
  };
}

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5, project_id: 1, title: "基礎を固める", due_on: "2026-10-31", sort_order: 1, status: "open",
    completed_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: stamp, ...overrides,
  };
}

function request(path: string, method: string, header: string, body: unknown) {
  return new Request(`https://hub.example${path}`, {
    method,
    headers: { Origin: "https://hub.example", "Content-Type": "application/json", "X-Dashboard-Action": header },
    body: JSON.stringify(body),
  });
}

function milestoneBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 1, originalProjectUpdatedAt: stamp, milestoneId: null, originalUpdatedAt: null,
    operation: "create", title: " 基礎を固める ", dueOn: "2026-10-31", ...overrides,
  };
}

test("マイルストンを並び順でProjectに付け、取り消し以外のタスクから進捗を数える", () => {
  const { projects } = normalizeProjects([projectRow()], [
    actionRow({ id: 11, milestone_id: 5 }),
    actionRow({ id: 12, milestone_id: 5, status: "done", completed_at: stamp, sort_order: null }),
    actionRow({ id: 13, milestone_id: 5, status: "cancelled", sort_order: null }),
    actionRow({ id: 14, milestone_id: null, sort_order: 2 }),
  ], [], [milestoneRow({ id: 6, sort_order: 2, title: "会話に慣れる" }), milestoneRow()]);
  const project = projects[0];
  assert.deepEqual(project.milestones.map((milestone) => [milestone.id, milestone.done, milestone.total]), [[5, 1, 2], [6, 0, 0]]);
  assert.equal(project.actions.find((action) => action.id === 11)?.milestoneId, 5);
  assert.equal(project.actions.find((action) => action.id === 14)?.milestoneId, null);

  // milestone_id の無い応答（migration前）でも読み込める
  const legacy = actionRow();
  delete (legacy as Record<string, unknown>).milestone_id;
  assert.equal(normalizeProjects([projectRow()], [legacy], []).projects[0].actions[0].milestoneId, null);
  assert.deepEqual(normalizeProjects([projectRow()], [legacy], []).projects[0].milestones, []);

  // 別のProjectのマイルストンや、存在しないProjectのマイルストンは受け付けない
  assert.throws(() => normalizeProjects([projectRow(), projectRow({ id: 2 })], [actionRow({ project_id: 2, milestone_id: 5 })], [], [milestoneRow()]), /orphan/);
  assert.throws(() => normalizeProjects([projectRow()], [], [], [milestoneRow({ project_id: 9 })]), /orphan/);
  assert.throws(() => normalizeProjects([projectRow()], [], [], [milestoneRow({ status: "closed" })]), /invalid/);
});

test("マイルストンの入力は、作成ではIDなし、編集では名前が必須、その他の操作では名前と期日を受け付けない", async () => {
  const create = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update", milestoneBody()));
  assert.deepEqual(create, {
    ok: true,
    value: { projectId: 1, originalProjectUpdatedAt: stamp, milestoneId: null, originalUpdatedAt: null, operation: "create", title: "基礎を固める", dueOn: "2026-10-31" },
  });
  const createWithId = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update", milestoneBody({ milestoneId: 5 })));
  assert.equal(createWithId.ok, false);
  const editNoTitle = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update",
    milestoneBody({ operation: "edit", milestoneId: 5, originalUpdatedAt: stamp, title: " " })));
  assert.equal(editNoTitle.ok, false);
  for (const operation of ["complete", "reopen", "move_up", "move_down", "delete"]) {
    const result = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update",
      milestoneBody({ operation, milestoneId: 5, originalUpdatedAt: stamp, title: null, dueOn: null })));
    assert.equal(result.ok, true, operation);
  }
  const completeWithTitle = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update",
    milestoneBody({ operation: "complete", milestoneId: 5, originalUpdatedAt: stamp })));
  assert.equal(completeWithTitle.ok, false);
  const missingLock = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update",
    milestoneBody({ operation: "delete", milestoneId: 5, title: null, dueOn: null })));
  assert.equal(missingLock.ok, false);
  const unknown = await readProjectMilestoneUpdateInput(request("/api/project-milestones", "PATCH", "project-milestone-update",
    milestoneBody({ operation: "archive", milestoneId: 5, originalUpdatedAt: stamp, title: null, dueOn: null })));
  assert.equal(unknown.ok, false);
});

test("まとめて追加は空行を除いて1行1件にし、50件・500文字を超えると拒否する", async () => {
  const bulk = (contents: unknown, milestoneId: unknown = 5) => readProjectActionCreateInput(request("/api/project-actions", "POST", "project-action-create", {
    operation: "addBulk", projectId: 1, contents, milestoneId, originalProjectUpdatedAt: stamp,
  }));
  assert.deepEqual(await bulk([" 教材を比べる ", "", "  ", "体験レッスンを予約する"]), {
    ok: true,
    value: { operation: "addBulk", projectId: 1, contents: ["教材を比べる", "体験レッスンを予約する"], milestoneId: 5, originalProjectUpdatedAt: stamp },
  });
  assert.equal((await bulk(["a"], null)).ok, true);
  assert.equal((await bulk(["", " "])).ok, false);
  assert.equal((await bulk(Array.from({ length: 51 }, (_, index) => `task ${index}`))).ok, false);
  assert.equal((await bulk(["あ".repeat(501)])).ok, false);
  assert.equal((await bulk("教材を比べる")).ok, false);
});

test("タスクの編集はマイルストンを必須で送り、完了などの操作は従来どおり送らなくてよい", async () => {
  const base = { actionId: 11, originalUpdatedAt: stamp, content: "教材を決める", dueOn: null, startOn: null };
  const edit = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", "project-action-update", { ...base, operation: "edit", milestoneId: 5 }));
  assert.equal(edit.ok && edit.value.milestoneId, 5);
  const editWithout = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", "project-action-update", { ...base, operation: "edit" }));
  assert.equal(editWithout.ok, false);
  const complete = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", "project-action-update",
    { ...base, operation: "complete", content: null }));
  assert.equal(complete.ok && complete.value.milestoneId, null);
  const completeWithMilestone = await readProjectActionUpdateInput(request("/api/project-actions", "PUT", "project-action-update",
    { ...base, operation: "complete", content: null, milestoneId: 5 }));
  assert.equal(completeWithMilestone.ok, false);
});

test("マイルストンの更新とまとめて追加は、それぞれ1つのRPCに渡し、DBの拒否を画面向けの文言にする", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ path: string; body: Record<string, unknown> }> = [];
  let reject: string | null = null;
  globalThis.fetch = async (input, init) => {
    captured.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return reject ? new Response(JSON.stringify({ message: reject }), { status: 400 }) : Response.json(1);
  };
  try {
    await updateProjectMilestone(env, {
      projectId: 1, originalProjectUpdatedAt: stamp, milestoneId: 5, originalUpdatedAt: stamp, operation: "edit", title: "基礎", dueOn: null,
    });
    assert.equal(captured[0].path, "/rest/v1/rpc/update_project_milestone");
    assert.deepEqual(captured[0].body, {
      p_project_id: 1, p_project_updated_at: stamp, p_milestone_id: 5, p_milestone_updated_at: stamp,
      p_operation: "edit", p_title: "基礎", p_due_on: null,
    });
    await createProjectAction(env, { operation: "addBulk", projectId: 1, contents: ["a", "b"], milestoneId: 5, originalProjectUpdatedAt: stamp });
    assert.equal(captured[1].path, "/rest/v1/rpc/add_project_queued_actions");
    assert.deepEqual(captured[1].body, { p_project_id: 1, p_project_updated_at: stamp, p_contents: ["a", "b"], p_milestone_id: 5 });

    const cases: Array<[string, string, number]> = [
      ["MILESTONE_CONFLICT", "PROJECT_MILESTONE_CONFLICT", 409],
      ["MILESTONE_MOVE_OUT_OF_RANGE", "PROJECT_MILESTONE_CONFLICT", 409],
      ["MILESTONE_TITLE_REQUIRED", "PROJECT_MILESTONE_INVALID", 400],
      ["ACTION_MILESTONE_INVALID", "PROJECT_ACTION_MILESTONE_INVALID", 400],
      ["violates foreign key constraint \"project_actions_milestone_same_project_fkey\"", "PROJECT_ACTION_MILESTONE_INVALID", 400],
      ["ACTIONS_COUNT_INVALID", "PROJECT_ACTION_INVALID", 400],
      ["PROJECT_CONFLICT", "PROJECT_UPDATE_CONFLICT", 409],
    ];
    for (const [message, code, status] of cases) {
      reject = message;
      await assert.rejects(
        updateProjectMilestone(env, {
          projectId: 1, originalProjectUpdatedAt: stamp, milestoneId: 5, originalUpdatedAt: stamp, operation: "complete", title: null, dueOn: null,
        }),
        (error: unknown) => {
          const failure = publicProjectError(error);
          assert.equal(failure.code, code, message);
          assert.equal(failure.status, status, message);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /api/project-milestones は専用ヘッダーで受け付け、最新のProject一覧を返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rpc/")) return Response.json(5);
    if (url.pathname.endsWith("/projects")) return Response.json([projectRow()]);
    if (url.pathname.endsWith("/project_actions")) return Response.json([actionRow({ milestone_id: 5 })]);
    if (url.pathname.endsWith("/project_milestones")) return Response.json([milestoneRow()]);
    return Response.json([]);
  };
  try {
    const response = await milestonesRoute({ request: request("/api/project-milestones", "PATCH", "project-milestone-update", milestoneBody()), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.projects[0].milestones[0].title, "基礎を固める");
    assert.equal(payload.projects[0].milestones[0].total, 1);
    const wrongHeader = await milestonesRoute({ request: request("/api/project-milestones", "PATCH", "project-action-update", milestoneBody()), env });
    assert.equal(wrongHeader.status, 403);
    const post = await milestonesRoute({ request: new Request("https://hub.example/api/project-milestones", { method: "POST" }), env });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("Allow"), "PATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrationはマイルストン表と同じProjectに限る外部キーを作り、RPCをservice_roleだけに開く", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202610100001_project_milestones.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.project_milestones/);
  assert.match(migration, /unique \(project_id, id\)/);
  assert.match(migration, /foreign key \(project_id, milestone_id\)\s+references public\.project_milestones \(project_id, id\)/);
  assert.match(migration, /revoke all on table public\.project_milestones from anon, authenticated;/);
  assert.match(migration, /drop function if exists public\.update_project_action\(bigint, timestamptz, text, text, date, date\);/);
  for (const signature of [
    "update_project_milestone(bigint, timestamptz, bigint, timestamptz, text, text, date)",
    "add_project_queued_actions(bigint, timestamptz, text[], bigint)",
    "update_project_action(bigint, timestamptz, text, text, date, date, bigint)",
  ]) {
    const escaped = signature.replace(/[()[\]]/g, "\\$&");
    assert.match(migration, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
  }
  // マイルストンを消してもタスクは残す
  assert.match(migration, /set milestone_id = null, updated_at = now\(\)\s+where milestone_id = v_milestone\.id;\s+delete from public\.project_milestones/);
  // 並べ替えは同じマイルストンの中で
  assert.match(migration, /milestone_id is not distinct from v_action\.milestone_id/);
  assert.doesNotMatch(migration, /^\s*(begin|commit);/m);
});

test("Project詳細はマイルストンごとにタスクをまとめ、追加・編集・達成・並べ替え・まとめて追加ができる", async () => {
  const [script, css, exportSnapshot] = await Promise.all([
    readFile(new URL("../public/projects.js", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.css", import.meta.url), "utf8"),
    readFile(new URL("../functions/_shared/exportSnapshot.ts", import.meta.url), "utf8"),
  ]);
  assert.match(script, /"X-Dashboard-Action": "project-milestone-update"/);
  assert.match(script, /fetch\("\/api\/project-milestones"/);
  for (const operation of ["move_up", "move_down", "delete"]) assert.match(script, new RegExp(`data-milestone-op="${operation}"`));
  assert.match(script, /data-milestone-op="\$\{done \? "reopen" : "complete"\}"/);
  assert.match(script, /operation: "addBulk"/);
  assert.match(script, /split\(\/\\r\?\\n\/\)/);
  assert.match(script, /<select name="milestoneId">/);
  assert.match(script, /マイルストンなし/);
  assert.match(script, /目標日より後/);
  assert.match(script, /マイルストンの期日より後/);
  assert.match(css, /\.milestone-group \{/);
  assert.match(css, /\.bulk-add/);
  assert.match(exportSnapshot, /"project_milestones"/);
});

test("Hubの「着手が必要」に、タスクのマイルストン名を添える", () => {
  const next = { id: 10, content: "教材を決める", status: "next" as const, milestoneId: 5, completedAt: null, updatedAt: stamp };
  const html = renderProjectSection({
    status: "ready",
    data: { projects: [{ id: 1, title: "英語", status: "active", targetOn: null, reviewOn: null, nextAction: next, actions: [next], milestones: [{ id: 5, title: "<基礎>" }] }] },
    error: null,
  }, { now: new Date("2026-10-10T00:00:00Z") });
  assert.match(html, /英語 · &lt;基礎&gt;/);
});
