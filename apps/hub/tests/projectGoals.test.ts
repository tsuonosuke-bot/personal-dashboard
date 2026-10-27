import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/project-goals.ts";
import {
  readProjectGoalInput,
  loadProjectGoalStatus,
  saveProjectGoal,
} from "../functions/_shared/projectGoals.ts";
const goalsModulePath = "../public/projects/goals.js";
const {
  createCaptureRequest,
  readCaptureDraft,
  saveCaptureDraft,
  reviewReasons,
  goalProgress,
  mergeReviewActions,
} = await import(goalsModulePath);

const stamp = "2026-10-27T00:00:00.123456+00:00";
const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "server-test-key" };
const capture = {
  operation: "capture" as const,
  requestId: "12345678-1234-4000-8000-123456789012",
  projectId: 1,
  projectUpdatedAt: stamp,
  content: " 行動を試す ",
};
const goal = {
  projectId: 1,
  projectUpdatedAt: stamp,
  fingerprint: "a".repeat(32),
  lastReviewedAt: null,
  reviewCurrent: false,
  weekDone: 4,
  nextMilestone: { id: 2, title: "最初の成果", dueOn: null },
};
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/project-goals", {
    method: "POST",
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "project-goal-update",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

test("goal mutations validate exact payloads, microsecond snapshots and capture vs review", () => {
  const parsed = readProjectGoalInput(capture);
  assert.equal(parsed?.content, "行動を試す");
  assert.equal(parsed?.projectUpdatedAt, stamp);
  assert.equal(readProjectGoalInput({ ...capture, automaticResume: true }), null);
  assert.equal(readProjectGoalInput({ ...capture, projectId: -1 }), null);
  assert.equal(readProjectGoalInput({ ...capture, content: " " }), null);
  assert.equal(readProjectGoalInput({ ...capture, content: "a".repeat(501) }), null);
  assert.equal(readProjectGoalInput({ ...capture, requestId: "not-uuid" }), null);
  assert.equal(
    readProjectGoalInput({
      operation: "review",
      requestId: capture.requestId,
      projectId: 1,
      projectUpdatedAt: stamp,
      fingerprint: "a".repeat(32),
    })?.operation,
    "review",
  );
});

test("goal endpoint rejects cross-origin/header-free writes before any data request", async () => {
  await withFetch(
    async () => {
      throw new Error("unexpected data request");
    },
    async () => {
      assert.equal(
        (await onRequest({ request: request(capture, { Origin: "https://other.example" }), env }))
          .status,
        403,
      );
      assert.equal(
        (await onRequest({ request: request(capture, { "X-Dashboard-Action": "other" }), env }))
          .status,
        403,
      );
      assert.equal(
        (await onRequest({ request: request({ ...capture, content: null }), env })).status,
        400,
      );
    },
  );
});

test("goal status is a bounded full-DB projection with JST week input, not visible history count", async () => {
  await withFetch(
    async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/rest/v1/rpc/get_project_goal_status");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        p_project_ids: [1],
        p_today: "2026-10-26",
      });
      return Response.json([goal]);
    },
    async () => {
      const rows = await loadProjectGoalStatus(env, [1], new Date("2026-10-25T15:00:00Z"));
      assert.equal(rows[0].weekDone, 4);
      assert.equal(rows[0].nextMilestone?.title, "最初の成果");
    },
  );
  const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
  assert.equal(
    (
      await onRequest({
        request: new Request(`https://hub.example/api/project-goals?ids=${ids}`),
        env,
      })
    ).status,
    400,
  );
});

test("capture sends a single stable idempotency payload and preserves request identity on replay", async () => {
  const bodies: unknown[] = [];
  await withFetch(
    async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/rest/v1/rpc/capture_project_action");
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ saved: true, projectId: 1, actionId: 9 });
    },
    async () => {
      const parsed = readProjectGoalInput(capture)!;
      assert.equal((await saveProjectGoal(env, parsed)).actionId, 9);
      assert.equal((await saveProjectGoal(env, parsed)).actionId, 9);
      assert.deepEqual(bodies[0], bodies[1]);
      assert.equal(
        (bodies[0] as { p_request: Record<string, unknown> }).p_request.operation,
        undefined,
      );
    },
  );
});

test("only a proven uncommitted project CAS conflict allows capture rebase", async () => {
  for (const [marker, canRebase] of [
    ["PROJECT_CONFLICT", true],
    ["GOAL_REQUEST_CONFLICT", false],
    ["GOAL_REVIEW_CONFLICT", false],
  ] as const) {
    await withFetch(
      async () => Response.json({ message: marker }, { status: 409 }),
      async () => {
        const result = await onRequest({ request: request(capture), env });
        assert.equal(result.status, 409);
        assert.equal((await result.json()).canRebase, canRebase);
      },
    );
  }
});

test("goal read/save failures do not return a zero or a claimed successful save", async () => {
  await withFetch(
    async () => Response.json([{ ...goal, weekDone: -1 }]),
    async () => {
      await assert.rejects(loadProjectGoalStatus(env, [1]), /読み取れません/);
    },
  );
  await withFetch(
    async () => {
      throw new Error("lost response");
    },
    async () => {
      const result = await onRequest({ request: request(capture), env });
      assert.equal(result.status, 502);
      assert.equal((await result.json()).saved, undefined);
    },
  );
});

test("capture drafts survive unknown results without replacing the original request", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const pending = createCaptureRequest(
    { id: 1, updatedAt: stamp },
    "行動を試す",
    capture.requestId,
  );
  const draft = { content: "行動を試す", pending };
  saveCaptureDraft(storage, 1, draft);
  assert.deepEqual(readCaptureDraft(storage, 1), draft);
  assert.equal(readCaptureDraft(storage, 2), null);
  values.set("project-capture:2", JSON.stringify(draft));
  assert.equal(readCaptureDraft(storage, 2), null);
  saveCaptureDraft(storage, 1, null);
  assert.equal(readCaptureDraft(storage, 1), null);
});

test("portfolio data stays unknown without projection, while review reasons are deduplicated by Project", () => {
  const project = { id: 1, needsAttention: true, stale: true, actions: [] };
  assert.equal(goalProgress(project, null, "2026-10-26").weekDone, null);
  assert.equal(goalProgress(project, goal, "2026-10-26").weekDone, 4);
  assert.deepEqual(
    reviewReasons(project, { targetOverdue: [project], overdue: [{ project }, { project }] }),
    ["目標期限超過", "タスク期限超過 2件", "要確認", "更新なし"],
  );
});

test("review retains all current-week completions when detail only returns a terminal page", () => {
  const actions = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    status: "done",
    completedAt: stamp,
  }));
  const previous = { actions };
  const current = { actions: actions.slice(0, 10) };
  const merged = mergeReviewActions(previous, current);
  assert.equal(merged.filter((entry: { status: string }) => entry.status === "done").length, 12);
  const reopened = mergeReviewActions(
    { reviewActions: merged },
    { actions: [{ ...actions[11], status: "queued" }] },
  );
  assert.equal(reopened.filter((entry: { status: string }) => entry.status === "done").length, 11);
});
