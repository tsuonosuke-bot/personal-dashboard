import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeProjects,
  publicProjectError,
  readProjectActionUpdateInput,
  updateProjectAction,
} from "../functions/_shared/projects.ts";
import { onRequest as projectActionsRoute } from "../functions/api/project-actions.ts";

// #153: あとで行うActionを編集・完了・取消・並べ替え・今やる（ピン）にでき、着手日と期日を持てる。

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
const preciseTimestamp = "2026-10-09T01:02:03.123456+00:00";

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "英語を話せるようにする", outcome: "10分の雑談ができる", theme: null, status: "active",
    target_on: null, review_on: null, waiting_for: null, completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: preciseTimestamp, ...overrides,
  };
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, project_id: 1, project_item_id: null, content: "教材を決める", status: "queued",
    due_on: null, start_on: null, sort_order: null, waiting_for: null, completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: preciseTimestamp, ...overrides,
  };
}

function updateRequest(body: Record<string, unknown>, header = "project-action-update") {
  return new Request("https://hub.example/api/project-actions", {
    method: "PUT",
    headers: { Origin: "https://hub.example", "Content-Type": "application/json", "X-Dashboard-Action": header },
    body: JSON.stringify(body),
  });
}

function updateBody(overrides: Record<string, unknown> = {}) {
  return {
    actionId: 11, originalUpdatedAt: preciseTimestamp, operation: "edit",
    content: "  教材を1冊に絞る ", dueOn: "2026-10-20", startOn: "2026-10-12", ...overrides,
  };
}

test("Actionの着手日・期日・並び順を読み、あとで行うActionは並べ替えた順に並ぶ", () => {
  const { projects } = normalizeProjects([projectRow()], [
    actionRow({ id: 11, sort_order: 2, created_at: "2026-10-01T00:00:00.000Z" }),
    actionRow({ id: 12, sort_order: 1, created_at: "2026-10-02T00:00:00.000Z", due_on: "2026-10-15", start_on: "2026-10-10" }),
    actionRow({ id: 13, sort_order: null, created_at: "2026-09-30T00:00:00.000Z" }),
    actionRow({ id: 14, status: "next" }),
  ], []);
  const actions = projects[0].actions;
  assert.deepEqual(actions.map((action) => action.id), [14, 12, 11, 13]);
  assert.equal(actions[1].startOn, "2026-10-10");
  assert.equal(actions[1].dueOn, "2026-10-15");
  assert.equal(actions[1].sortOrder, 1);
});

test("start_on・sort_order が無い応答（migration前）でも読み込める", () => {
  const row = actionRow();
  delete (row as Record<string, unknown>).start_on;
  delete (row as Record<string, unknown>).sort_order;
  const { projects } = normalizeProjects([projectRow()], [row], []);
  assert.equal(projects[0].actions[0].startOn, null);
  assert.equal(projects[0].actions[0].sortOrder, null);
  assert.throws(() => normalizeProjects([projectRow()], [actionRow({ sort_order: "1" })], []), /invalid data/);
});

test("Actionの編集入力は内容と日付を検証し、編集以外の操作では値を受け付けない", async () => {
  const edit = await readProjectActionUpdateInput(updateRequest(updateBody()));
  assert.deepEqual(edit, {
    ok: true,
    value: {
      actionId: 11, originalUpdatedAt: preciseTimestamp, operation: "edit",
      content: "教材を1冊に絞る", dueOn: "2026-10-20", startOn: "2026-10-12",
    },
  });
  const cleared = await readProjectActionUpdateInput(updateRequest(updateBody({ dueOn: null, startOn: null })));
  assert.equal(cleared.ok && cleared.value.dueOn, null);

  const reversed = await readProjectActionUpdateInput(updateRequest(updateBody({ startOn: "2026-10-21" })));
  assert.equal(reversed.ok, false);
  const empty = await readProjectActionUpdateInput(updateRequest(updateBody({ content: "  " })));
  assert.equal(empty.ok, false);
  const badDate = await readProjectActionUpdateInput(updateRequest(updateBody({ dueOn: "10/20" })));
  assert.equal(badDate.ok, false);

  for (const operation of ["complete", "cancel", "pin", "move_up", "move_down"]) {
    const result = await readProjectActionUpdateInput(updateRequest(updateBody({ operation, content: null, dueOn: null, startOn: null })));
    assert.equal(result.ok, true, operation);
    if (result.ok) assert.equal(result.value.operation, operation);
  }
  const extraValues = await readProjectActionUpdateInput(updateRequest(updateBody({ operation: "complete" })));
  assert.equal(extraValues.ok, false);
  const unknown = await readProjectActionUpdateInput(updateRequest(updateBody({ operation: "delete", content: null, dueOn: null, startOn: null })));
  assert.equal(unknown.ok, false);
  const missingKey = await readProjectActionUpdateInput(updateRequest({ actionId: 11, originalUpdatedAt: preciseTimestamp, operation: "pin" }));
  assert.equal(missingKey.ok, false);
});

test("Actionの更新は1つのRPCに楽観ロック用の更新日時ごと渡し、DBの拒否を画面向けの文言にする", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ path: string; body: Record<string, unknown> }> = [];
  let reject: string | null = null;
  globalThis.fetch = async (input, init) => {
    captured.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return reject ? new Response(JSON.stringify({ message: reject }), { status: 400 }) : Response.json(1);
  };
  try {
    await updateProjectAction(env, {
      actionId: 11, originalUpdatedAt: preciseTimestamp, operation: "edit", content: "教材を決める", dueOn: "2026-10-20", startOn: null,
    });
    assert.equal(captured[0].path, "/rest/v1/rpc/update_project_action");
    assert.deepEqual(captured[0].body, {
      p_action_id: 11, p_action_updated_at: preciseTimestamp, p_operation: "edit",
      p_content: "教材を決める", p_due_on: "2026-10-20", p_start_on: null,
    });

    const cases: Array<[string, string, number]> = [
      ["ACTION_CONFLICT", "PROJECT_ACTION_CONFLICT", 409],
      ["ACTION_MOVE_OUT_OF_RANGE", "PROJECT_ACTION_CONFLICT", 409],
      ["ACTION_DATES_INVALID", "PROJECT_ACTION_DATES_INVALID", 400],
      ["new row violates check constraint \"project_actions_start_before_due\"", "PROJECT_ACTION_DATES_INVALID", 400],
      ["ACTION_CONTENT_REQUIRED", "PROJECT_ACTION_INVALID", 400],
      ["PROJECT_NOT_ACTIVE", "PROJECT_NOT_ACTIVE", 409],
      ["PROJECT_NOT_OPEN", "PROJECT_NOT_OPEN", 409],
    ];
    for (const [message, code, status] of cases) {
      reject = message;
      await assert.rejects(
        updateProjectAction(env, { actionId: 11, originalUpdatedAt: preciseTimestamp, operation: "pin", content: null, dueOn: null, startOn: null }),
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

test("PUT /api/project-actions は専用ヘッダーで受け付け、最新のProject一覧を返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rpc/")) return Response.json(1);
    if (url.pathname.endsWith("/projects")) return Response.json([projectRow()]);
    if (url.pathname.endsWith("/project_actions")) {
      assert.match(url.searchParams.get("select") || "", /start_on,sort_order/);
      return Response.json([actionRow({ status: "next", due_on: "2026-10-20" })]);
    }
    return Response.json([]);
  };
  try {
    const response = await projectActionsRoute({ request: updateRequest(updateBody()), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.projects[0].nextAction.dueOn, "2026-10-20");

    const wrongHeader = await projectActionsRoute({ request: updateRequest(updateBody(), "project-action-resolve"), env });
    assert.equal(wrongHeader.status, 403);
    const invalid = await projectActionsRoute({ request: updateRequest(updateBody({ startOn: "2026-10-30" })), env });
    assert.equal(invalid.status, 400);

    const deleteResponse = await projectActionsRoute({
      request: new Request("https://hub.example/api/project-actions", { method: "DELETE" }), env,
    });
    assert.equal(deleteResponse.status, 405);
    assert.equal(deleteResponse.headers.get("Allow"), "POST, PATCH, PUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrationは着手日・並び順を追加し、next の1件制約を残したまま更新用RPCをservice_roleだけに開く", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202610090001_project_action_edit.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column if not exists start_on date/);
  assert.match(migration, /add column if not exists sort_order integer/);
  assert.match(migration, /check \(start_on is null or due_on is null or start_on <= due_on\)/);
  assert.doesNotMatch(migration, /project_actions_one_next_idx/);
  assert.match(migration, /create or replace function public\.update_project_action\(/);
  for (const operation of ["edit", "complete", "cancel", "pin", "move_up", "move_down"]) {
    assert.match(migration, new RegExp(`'${operation}'`));
  }
  // ピン留めは今のnextを先に戻してから昇格させる（部分ユニーク索引に当たらない順序）。
  const demote = migration.indexOf("set status = 'queued', sort_order = 0");
  const promote = migration.indexOf("set status = 'next', sort_order = null");
  assert.ok(demote > 0 && promote > demote);
  assert.match(migration, /revoke all on function public\.update_project_action\(bigint, timestamptz, text, text, date, date\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.update_project_action\(bigint, timestamptz, text, text, date, date\) to service_role;/);
  assert.doesNotMatch(migration, /^\s*(begin|commit);/m);
});

test("Project詳細で、あとで行うActionを並べ替え・今やる・完了・編集でき、日付をチップで示す", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../public/projects.js", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /"X-Dashboard-Action": "project-action-update"/);
  assert.match(script, /method: "PUT"/);
  for (const operation of ["move_up", "move_down", "pin", "complete", "cancel"]) {
    assert.match(script, new RegExp(`data-action-op="${operation}"`));
  }
  assert.match(script, /data-action-edit-open/);
  assert.match(script, /name="startOn" type="date"/);
  assert.match(script, /name="dueOn" type="date"/);
  assert.match(script, /window\.confirm\("このActionを取り消しますか？"\)/);
  assert.match(script, /日超過/);
  assert.doesNotMatch(script, /<small>候補<\/small>/);
  assert.match(css, /\.date-chip\.overdue/);
  assert.match(css, /\.task-row \{/);
});

test("要確認は「activeなのに未完了のActionが1件もない」Project（#154）", () => {
  const onlyQueued = normalizeProjects([projectRow()], [actionRow({ status: "queued" })], []);
  assert.equal(onlyQueued.projects[0].needsAttention, false);
  const onlyDone = normalizeProjects([projectRow()], [actionRow({ status: "done", completed_at: preciseTimestamp })], []);
  assert.equal(onlyDone.projects[0].needsAttention, true);
  const waitingProject = normalizeProjects(
    [projectRow({ status: "waiting", waiting_for: "返信", review_on: "2026-10-20" })], [], [],
  );
  assert.equal(waitingProject.projects[0].needsAttention, false);
});
