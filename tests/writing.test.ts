import assert from "node:assert/strict";
import test from "node:test";
import {
  loadWriting,
  normalizeWritingRows,
  readWritingUpdateInput,
  updateWritingTopic,
  validateWritingMutationRequest,
} from "../functions/_shared/writing.ts";
import { onRequest as writingRoute } from "../functions/api/writing.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    source_route_id: 17,
    source_want_id: 27,
    title: "AIと思考について書く",
    question: "AIは思考を深めるのか",
    status: "candidate",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function mutationRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/writing", {
    method: "PATCH",
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "writing-update",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "AIと思考について書く",
    question: "AIは思考を深めるのか",
    status: "drafting",
    originalUpdatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

test("Writing rows preserve their Want relationship and sort by latest update", () => {
  const preciseUpdatedAt = "2026-09-20T01:00:00.123456+00:00";
  const items = normalizeWritingRows([
    row({ id: 7, updated_at: "2026-09-19T00:00:00Z" }),
    row({ id: 8, source_route_id: 18, source_want_id: 28, status: "completed", updated_at: preciseUpdatedAt }),
  ]);
  assert.deepEqual(items.map((item) => item.id), [8, 7]);
  assert.equal(items[0].sourceWantId, 28);
  assert.equal(items[0].status, "completed");
  assert.equal(items[0].updatedAt, preciseUpdatedAt);
  assert.throws(() => normalizeWritingRows([row({ status: "unknown" })]), /invalid data/);
});

test("Writing GET keeps the Supabase secret in server-side headers and summarizes statuses", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return Response.json([
      row(),
      row({ id: 8, source_route_id: 18, source_want_id: 28, status: "researching" }),
      row({ id: 9, source_route_id: 19, source_want_id: 29, status: "completed" }),
    ]);
  };
  try {
    const payload = await loadWriting(env);
    assert.equal(payload.items.length, 3);
    assert.deepEqual(payload.summary, { active: 2, ideas: 2, drafting: 0, completed: 1 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.apikey, "server-secret");
    assert.doesNotMatch(requests[0].url, /server-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Writing PATCH requires same-origin JSON and its explicit action header", () => {
  assert.equal(validateWritingMutationRequest(mutationRequest(validInput())), null);
  assert.equal(validateWritingMutationRequest(mutationRequest(validInput(), { Origin: "https://evil.example" }))?.status, 403);
  assert.equal(validateWritingMutationRequest(mutationRequest(validInput(), { "X-Dashboard-Action": "wrong" }))?.status, 403);
  assert.equal(validateWritingMutationRequest(mutationRequest(validInput(), { "Content-Type": "text/plain" }))?.status, 415);
});

test("Writing PATCH validates all editable fields", async () => {
  const valid = await readWritingUpdateInput(mutationRequest(validInput()));
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.status, "drafting");
  }
  const legacyStatus = await readWritingUpdateInput(mutationRequest(validInput({ status: "outlining" })));
  assert.equal(legacyStatus.ok, false);
  const invalidStatus = await readWritingUpdateInput(mutationRequest(validInput({ status: "published" })));
  assert.equal(invalidStatus.ok, false);
  const extraField = await readWritingUpdateInput(mutationRequest({ ...validInput(), extra: true }));
  assert.equal(extraField.ok, false);
});

test("Writing update uses id and updated_at for a conflict-safe write", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json([row({ status: "drafting" })]);
  };
  try {
    const parsed = await readWritingUpdateInput(mutationRequest(validInput()));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const item = await updateWritingTopic(env, parsed.value);
    const captured = requests[0];
    assert.equal(item.status, "drafting");
    assert.equal(captured.url.searchParams.get("id"), "eq.7");
    assert.equal(captured.url.searchParams.get("updated_at"), "eq.2026-09-20T00:00:00.000Z");
    assert.equal(captured.init?.method, "PATCH");
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.title, validInput().title);
    assert.deepEqual(Object.keys(body).sort(), ["question", "status", "title", "updated_at"]);
    assert.match(body.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Writing update preserves PostgreSQL microsecond precision in its conflict condition", async () => {
  const originalFetch = globalThis.fetch;
  const updatedAt = "2026-09-20T01:00:00.123456+00:00";
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return Response.json([row({ status: "drafting", updated_at: "2026-09-20T02:00:00.000Z" })]);
  };
  try {
    const response = await writingRoute({
      request: mutationRequest(validInput({ originalUpdatedAt: updatedAt })),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal(new URL(seenUrl).searchParams.get("updated_at"), `eq.${updatedAt}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Writing update reports an optimistic conflict instead of overwriting", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const parsed = await readWritingUpdateInput(mutationRequest(validInput()));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    await assert.rejects(() => updateWritingTopic(env, parsed.value), (error: { code?: string; status?: number }) => {
      assert.equal(error.code, "WRITING_UPDATE_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Writing API supports GET and PATCH and rejects other methods", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === "PATCH"
    ? Response.json([row({ status: "drafting" })])
    : Response.json([row()]);
  try {
    const getResponse = await writingRoute({ request: new Request("https://hub.example/api/writing"), env });
    assert.equal(getResponse.status, 200);
    assert.equal((await getResponse.json()).items.length, 1);
    const patchResponse = await writingRoute({ request: mutationRequest(validInput()), env });
    assert.equal(patchResponse.status, 200);
    assert.equal((await patchResponse.json()).item.status, "drafting");
    const deleteResponse = await writingRoute({ request: new Request("https://hub.example/api/writing", { method: "DELETE" }), env });
    assert.equal(deleteResponse.status, 405);
    assert.equal(deleteResponse.headers.get("Allow"), "GET, PATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
