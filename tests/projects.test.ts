import assert from "node:assert/strict";
import test from "node:test";
import {
  createProject,
  createProjectAction,
  loadProjects,
  normalizeProjects,
  readProjectActionCreateInput,
  readProjectActionResolveInput,
  readProjectCreateInput,
  resolveProjectAction,
  updateProject,
  validateProjectMutationRequest,
} from "../functions/_shared/projects.ts";
import { onRequest as projectsRoute } from "../functions/api/projects.ts";
import { onRequest as projectActionsRoute } from "../functions/api/project-actions.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };
const preciseTimestamp = "2026-09-22T01:02:03.123456+00:00";

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Projectメニューを作る",
    outcome: "3件のProjectを日常運用できる",
    theme: "個人の情報管理",
    status: "active",
    target_on: "2026-10-01",
    review_on: null,
    waiting_for: null,
    completed_at: null,
    created_at: "2026-09-22T00:00:00.000Z",
    updated_at: preciseTimestamp,
    ...overrides,
  };
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    project_id: 1,
    project_item_id: null,
    content: "3件の実例を書き出す",
    status: "next",
    due_on: null,
    waiting_for: null,
    completed_at: null,
    created_at: "2026-09-22T00:00:00.000Z",
    updated_at: preciseTimestamp,
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    project_id: 1,
    source_type: "inbox",
    source_id: 41,
    source_content: "Project管理メニューを考える",
    treatment: "unprocessed",
    created_at: "2026-09-22T00:00:00.000Z",
    updated_at: preciseTimestamp,
    ...overrides,
  };
}

function mutationRequest(
  path: string,
  method: string,
  header: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new Request(`https://hub.example${path}`, {
    method,
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": header,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Projectメニューを作る",
    outcome: "3件のProjectを日常運用できる",
    theme: "個人の情報管理",
    targetOn: "2026-10-01",
    nextAction: "3件の実例を書き出す",
    ...overrides,
  };
}

function resolveBody(overrides: Record<string, unknown> = {}) {
  return {
    actionId: 11,
    originalUpdatedAt: preciseTimestamp,
    resolution: "continue",
    nextActionId: null,
    nextActionContent: "一覧画面を確認する",
    waitingFor: null,
    reviewOn: null,
    ...overrides,
  };
}

function tableResponse(input: RequestInfo | URL, init?: RequestInit): Response | null {
  const url = new URL(String(input));
  if (init?.method) return null;
  if (url.pathname.endsWith("/projects")) return Response.json([projectRow()]);
  if (url.pathname.endsWith("/project_actions")) return Response.json([actionRow()]);
  if (url.pathname.endsWith("/project_items")) return Response.json([]);
  return null;
}

test("Project rows combine actions and linked items and derive attention", () => {
  const waiting = projectRow({
    id: 2,
    title: "返事を待つProject",
    status: "waiting",
    target_on: null,
    review_on: "2026-09-29",
    waiting_for: "確認結果",
    updated_at: "2026-09-21T00:00:00.000Z",
  });
  const payload = normalizeProjects(
    [projectRow(), waiting],
    [actionRow(), actionRow({ id: 12, project_id: 1, content: "テストを書く", status: "queued" })],
    [itemRow()],
  );
  assert.equal(payload.projects[0].id, 1);
  assert.equal(payload.projects[0].nextAction?.content, "3件の実例を書き出す");
  assert.equal(payload.projects[0].updatedAt, preciseTimestamp);
  assert.equal(payload.projects[0].needsAttention, true);
  assert.deepEqual(payload.summary, {
    active: 1,
    needsAttention: 1,
    waiting: 1,
    completed: 0,
    openActions: 2,
    unprocessedItems: 1,
  });
});

test("Project normalization rejects multiple next actions and orphan rows", () => {
  assert.throws(
    () => normalizeProjects([projectRow()], [actionRow(), actionRow({ id: 12 })], []),
    /multiple next actions/,
  );
  assert.throws(
    () => normalizeProjects([projectRow()], [actionRow({ project_id: 99 })], []),
    /orphan rows/,
  );
});

test("Project GET loads all three tables without exposing the secret", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return tableResponse(input, init) || Response.json([], { status: 404 });
  };
  try {
    const payload = await loadProjects(env);
    assert.equal(payload.projects.length, 1);
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.headers.apikey, "server-secret");
      assert.doesNotMatch(request.url, /server-secret/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Project create validates same-origin input and requires the first action", async () => {
  const request = mutationRequest("/api/projects", "POST", "project-create", createBody());
  assert.equal(validateProjectMutationRequest(request.clone(), "project-create"), null);
  const parsed = await readProjectCreateInput(request.clone());
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.nextAction, "3件の実例を書き出す");

  const missingAction = await readProjectCreateInput(mutationRequest(
    "/api/projects", "POST", "project-create", createBody({ nextAction: " " }),
  ));
  assert.equal(missingAction.ok, false);
  const extraField = await readProjectCreateInput(mutationRequest(
    "/api/projects", "POST", "project-create", { ...createBody(), extra: true },
  ));
  assert.equal(extraField.ok, false);
  assert.equal(validateProjectMutationRequest(
    mutationRequest("/api/projects", "POST", "project-create", createBody(), { Origin: "https://evil.example" }),
    "project-create",
  )?.status, 403);
});

test("Project create uses the atomic database function", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: URL; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    captured.push({
      url: new URL(String(input)),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return Response.json(1);
  };
  try {
    await createProject(env, createBody());
    assert.equal(captured[0].url.pathname, "/rest/v1/rpc/create_project_with_next_action");
    assert.equal(captured[0].body.p_next_action, "3件の実例を書き出す");
    assert.equal(captured[0].headers.apikey, "server-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Project update preserves timestamp precision and detects conflicts", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = new URL("https://example.invalid");
  globalThis.fetch = async (input) => {
    seenUrl = new URL(String(input));
    return Response.json([]);
  };
  try {
    await assert.rejects(
      () => updateProject(env, {
        id: 1,
        title: "Projectメニューを作る",
        outcome: "運用できる",
        theme: null,
        targetOn: null,
        originalUpdatedAt: preciseTimestamp,
      }),
      (error: { code?: string; status?: number }) => {
        assert.equal(error.code, "PROJECT_UPDATE_CONFLICT");
        assert.equal(error.status, 409);
        return true;
      },
    );
    assert.equal(seenUrl.searchParams.get("updated_at"), `eq.${preciseTimestamp}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Queued action and resume requests use separate atomic functions", async () => {
  const addRequest = mutationRequest("/api/project-actions", "POST", "project-action-create", {
    operation: "addQueued",
    projectId: 1,
    content: "画面を確認する",
    originalProjectUpdatedAt: preciseTimestamp,
  });
  const resumeRequest = mutationRequest("/api/project-actions", "POST", "project-action-create", {
    operation: "resume",
    projectId: 1,
    content: "返事を確認する",
    originalProjectUpdatedAt: preciseTimestamp,
  });
  const add = await readProjectActionCreateInput(addRequest);
  const resume = await readProjectActionCreateInput(resumeRequest);
  assert.equal(add.ok, true);
  assert.equal(resume.ok, true);
  if (!add.ok || !resume.ok) return;

  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    paths.push(new URL(String(input)).pathname);
    return Response.json(1);
  };
  try {
    await createProjectAction(env, add.value);
    await createProjectAction(env, resume.value);
    assert.deepEqual(paths, [
      "/rest/v1/rpc/add_project_queued_action",
      "/rest/v1/rpc/resume_project_with_next_action",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Action completion requires a valid next state and calls one transaction", async () => {
  const valid = await readProjectActionResolveInput(mutationRequest(
    "/api/project-actions", "PATCH", "project-action-resolve", resolveBody(),
  ));
  assert.equal(valid.ok, true);
  const noNext = await readProjectActionResolveInput(mutationRequest(
    "/api/project-actions", "PATCH", "project-action-resolve",
    resolveBody({ nextActionContent: null }),
  ));
  assert.equal(noNext.ok, false);
  const invalidWaiting = await readProjectActionResolveInput(mutationRequest(
    "/api/project-actions", "PATCH", "project-action-resolve",
    resolveBody({ resolution: "waiting", nextActionContent: null, waitingFor: null, reviewOn: null }),
  ));
  assert.equal(invalidWaiting.ok, false);
  if (!valid.ok) return;

  const originalFetch = globalThis.fetch;
  const captured: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    captured.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return Response.json(1);
  };
  try {
    await resolveProjectAction(env, valid.value);
    assert.equal(captured[0].path, "/rest/v1/rpc/resolve_project_next_action");
    assert.equal(captured[0].body.p_action_updated_at, preciseTimestamp);
    assert.equal(captured[0].body.p_resolution, "continue");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Project APIs return refreshed state and reject unsupported methods", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rpc/")) return Response.json(1);
    return tableResponse(input, init) || Response.json([], { status: 404 });
  };
  try {
    const createResponse = await projectsRoute({
      request: mutationRequest("/api/projects", "POST", "project-create", createBody()),
      env,
    });
    assert.equal(createResponse.status, 201);
    assert.equal((await createResponse.json()).projects.length, 1);

    const actionResponse = await projectActionsRoute({
      request: mutationRequest("/api/project-actions", "PATCH", "project-action-resolve", resolveBody()),
      env,
    });
    assert.equal(actionResponse.status, 200);
    assert.equal((await actionResponse.json()).summary.active, 1);

    const deleteResponse = await projectsRoute({ request: new Request("https://hub.example/api/projects", { method: "DELETE" }), env });
    assert.equal(deleteResponse.status, 405);
    assert.equal(deleteResponse.headers.get("Allow"), "GET, POST, PATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
