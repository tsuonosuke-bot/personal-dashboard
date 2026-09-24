import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeFocusRows } from "../functions/_shared/focus.ts";
import { onRequest as focusRoute } from "../functions/api/focus.ts";

const env = {
  SUPABASE_URL: "https://compass.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
};

function focusRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source_route_id: 10,
    source_want_id: 20,
    content: "Keep the important thing visible",
    note: "A short reason",
    status: "active",
    sort_order: 1,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

function patchRequest(action: string, body: unknown, origin = "https://hub.example") {
  return new Request(`${origin}/api/focus`, {
    method: "PATCH",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
    },
    body: JSON.stringify(body),
  });
}

test("Focus normalization keeps active board order before archived items", () => {
  const items = normalizeFocusRows([
    focusRow({ id: 3, status: "archived", sort_order: null, updated_at: "2026-09-21T00:00:00Z" }),
    focusRow({ id: 2, sort_order: 2 }),
    focusRow({ id: 1, sort_order: 1 }),
  ]);
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3]);
  assert.equal(items[0].sourceWantId, 20);
});

test("Focus GET uses the server-side Supabase key and returns board metadata", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return Response.json([focusRow({ id: 2, sort_order: 2 }), focusRow({ id: 1, sort_order: 1 })]);
  };
  try {
    const response = await focusRoute({ request: new Request("https://hub.example/api/focus"), env });
    const body = await response.json() as { items: Array<{ id: number }>; activeCount: number; limit: number };
    assert.equal(response.status, 200);
    assert.deepEqual(body.items.map((item) => item.id), [1, 2]);
    assert.equal(body.activeCount, 2);
    assert.equal(body.limit, 5);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.apikey, "server-secret");
    assert.match(requests[0].url, /\/rest\/v1\/focus_items/);
    assert.doesNotMatch(JSON.stringify(body), /server-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus PATCH requires the same origin and the explicit action header", async () => {
  const body = {
    id: 1,
    content: "Focus",
    note: null,
    status: "active",
    original: { content: "Before", note: null, status: "active", sortOrder: 1 },
  };
  const missingOrigin = await focusRoute({
    request: new Request("https://hub.example/api/focus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "focus-update" },
      body: JSON.stringify(body),
    }),
    env,
  });
  assert.equal(missingOrigin.status, 403);

  const missingAction = await focusRoute({ request: patchRequest("wrong-action", body), env });
  assert.equal(missingAction.status, 403);
});

test("Focus update uses the original snapshot for conflict-safe writes", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json([focusRow({ content: "After", note: null })]);
  };
  try {
    const response = await focusRoute({
      request: patchRequest("focus-update", {
        id: 1,
        content: "After",
        note: null,
        status: "active",
        original: {
          content: "Keep the important thing visible",
          note: "A short reason",
          status: "active",
          sortOrder: 1,
        },
      }),
      env,
    });
    const url = new URL(capturedUrl);
    assert.equal(response.status, 200);
    assert.equal(url.searchParams.get("id"), "eq.1");
    assert.equal(url.searchParams.get("content"), "eq.Keep the important thing visible");
    assert.equal(url.searchParams.get("note"), "eq.A short reason");
    assert.equal(url.searchParams.get("sort_order"), "eq.1");
    assert.deepEqual(capturedBody, { content: "After", note: null, status: "active" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus update reports optimistic conflicts without overwriting", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const response = await focusRoute({
      request: patchRequest("focus-update", {
        id: 1,
        content: "After",
        note: null,
        status: "active",
        original: { content: "Before", note: null, status: "active", sortOrder: 1 },
      }),
      env,
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "このFocusは別の画面で更新されています。再読み込みしてからやり直してください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus activation returns the five-item limit as a clear conflict", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { code: "P0001", message: "FOCUS_ACTIVE_LIMIT" },
    { status: 400 },
  );
  try {
    const response = await focusRoute({
      request: patchRequest("focus-update", {
        id: 1,
        content: "Focus",
        note: null,
        status: "active",
        original: { content: "Focus", note: null, status: "archived", sortOrder: null },
      }),
      env,
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "表示できるFocusは5件までです。表示中の1件と入れ替えてください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus reorder sends the desired order and caller snapshot to one RPC", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: unknown;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return Response.json([focusRow({ id: 2, sort_order: 1 }), focusRow({ id: 1, sort_order: 2 })]);
  };
  try {
    const response = await focusRoute({
      request: patchRequest("focus-reorder", { ids: [2, 1], originalIds: [1, 2] }),
      env,
    });
    const body = await response.json() as { items: Array<{ id: number }> };
    assert.equal(response.status, 200);
    assert.match(capturedUrl, /\/rest\/v1\/rpc\/reorder_focus_items$/);
    assert.deepEqual(capturedBody, { p_ids: [2, 1], p_original_ids: [1, 2] });
    assert.deepEqual(body.items.map((item) => item.id), [2, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus reorder rejects more than five IDs before contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };
  try {
    const response = await focusRoute({
      request: patchRequest("focus-reorder", { ids: [1, 2, 3, 4, 5, 6], originalIds: [1, 2, 3, 4, 5, 6] }),
      env,
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus migration enforces five active items and restricts the reorder RPC", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609200004_focus_board.sql", import.meta.url), "utf8");
  assert.match(sql, /FOCUS_ACTIVE_LIMIT/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /create trigger focus_board_limit_trigger/i);
  assert.match(sql, /create or replace function public\.reorder_focus_items/i);
  assert.match(sql, /revoke all on function public\.reorder_focus_items\(bigint\[\], bigint\[\]\) from public/i);
  assert.match(sql, /grant execute on function public\.reorder_focus_items\(bigint\[\], bigint\[\]\) to service_role/i);
});

test("Focus swap sends both IDs to one RPC and returns the new active board", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body) });
    return Response.json([focusRow({ id: 1, sort_order: 1 }), focusRow({ id: 7, sort_order: 2 })]);
  };
  try {
    const response = await focusRoute({ request: patchRequest("focus-swap", { activateId: 7, archiveId: 2 }), env });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<{ id: number }> };
    assert.deepEqual(body.items.map((item) => item.id), [1, 7]);
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/rest/v1/rpc/swap_focus_items");
    assert.deepEqual(JSON.parse(requests[0].body), { p_activate_id: 7, p_archive_id: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus swap rejects invalid IDs and reports conflicts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "FOCUS_SWAP_CONFLICT" }), { status: 400 });
  try {
    for (const body of [{ activateId: 3, archiveId: 3 }, { activateId: 0, archiveId: 2 }, { activateId: 3 }]) {
      const invalid = await focusRoute({ request: patchRequest("focus-swap", body), env });
      assert.equal(invalid.status, 400);
    }
    const conflict = await focusRoute({ request: patchRequest("focus-swap", { activateId: 7, archiveId: 2 }), env });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "Focusが別の画面で更新されています。再読み込みしてからやり直してください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Focus overflow migration stores new items as archived and restricts the swap RPC", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609240001_focus_overflow_and_swap.sql", import.meta.url), "utf8");
  assert.match(sql, /if tg_op = 'INSERT' then\s+new\.status := 'archived';/);
  assert.match(sql, /message = 'FOCUS_ACTIVE_LIMIT'/);
  assert.match(sql, /create or replace function public\.swap_focus_items/);
  assert.match(sql, /revoke all on function public\.swap_focus_items\(bigint, bigint\) from anon;/);
  assert.match(sql, /grant execute on function public\.swap_focus_items\(bigint, bigint\) to service_role;/);
  const hub = await readFile(new URL("../public/hub.js", import.meta.url), "utf8");
  assert.match(hub, /data-focus-action="swap"/);
  assert.match(hub, /focusApi\("focus-swap"/);
});
