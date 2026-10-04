import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, readApiResponse, updateKnowledge } from "../src/lib/api.ts";

test("API clientはHTML成功応答を利用者向けエラーへ変換する", async () => {
  await assert.rejects(
    () => readApiResponse(new Response("<!doctype html><title>proxy</title>", { status: 200, headers: { "Content-Type": "text/html" } })),
    (error: unknown) => error instanceof ApiError && /想定外の応答/.test(error.message) && !/Unexpected token/.test(error.message),
  );
});

test("API clientは壊れたJSONの解析詳細を表示しない", async () => {
  await assert.rejects(
    () => readApiResponse(new Response("{broken", { status: 200, headers: { "Content-Type": "application/json" } })),
    (error: unknown) => error instanceof ApiError && /想定外の応答/.test(error.message) && !/JSON|position|token/i.test(error.message),
  );
});

const KNOWLEDGE_ID = "123e4567-e89b-42d3-a456-426614174000";

function knowledgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KNOWLEDGE_ID, title: "テスト", explanation: null, source_note: null, category: "技術",
    mastery: "学習中", priority: "中", ef: 2.5, reps: 1, interval_days: 2, times_asked: 3,
    times_correct: 2, learned_on: "2026-09-01", last_asked_on: null, tags: [], accuracy: 2 / 3,
    next_review_on: "2026-09-10", next_review_at: "2026-09-10T03:00:00Z", stability_hours: 48,
    relearning_stage: null, last_reviewed_at: null, mastery_streak: 1, archived: false,
    content_version: 1, created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/** PATCHは現在の版と一致したときだけ通す。復習の記録でサーバー側の版が先に進んだ状態を再現する。 */
function mockVersionedServer(serverVersion: number) {
  const calls: { method: string; version?: number }[] = [];
  const conflict = { error: "別の画面で更新されています。最新データを再読み込みしてください。" };
  const fetchMock: typeof fetch = async (_input, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      calls.push({ method });
      return Response.json(knowledgeRow({ content_version: serverVersion }));
    }
    const body = JSON.parse(String(init?.body)) as { expected_version: number; changes: Record<string, unknown> };
    calls.push({ method, version: body.expected_version });
    if (body.expected_version !== serverVersion) return Response.json(conflict, { status: 409 });
    return Response.json(knowledgeRow({ ...body.changes, content_version: serverVersion + 1 }));
  };
  return { calls, fetchMock };
}

test("復習の記録で版が進んでいても、優先度とアーカイブは最新版を取り直して保存する", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const changes of [{ priority: "最高" as const }, { archived: true }]) {
      const server = mockVersionedServer(5);
      globalThis.fetch = server.fetchMock;
      const updated = await updateKnowledge(KNOWLEDGE_ID, 3, changes);
      assert.equal(updated.content_version, 6);
      assert.deepEqual(server.calls, [
        { method: "PATCH", version: 3 },
        { method: "GET" },
        { method: "PATCH", version: 5 },
      ]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("内容の編集は版が古ければ送り直さず、競合として止める", async () => {
  const originalFetch = globalThis.fetch;
  const server = mockVersionedServer(5);
  globalThis.fetch = server.fetchMock;
  try {
    await assert.rejects(
      () => updateKnowledge(KNOWLEDGE_ID, 3, { title: "別のタイトル", priority: "高" }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(server.calls, [{ method: "PATCH", version: 3 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
