import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as inboxBulkRoute } from "../functions/api/inbox-bulk.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/inbox-bulk", {
    method: "PATCH",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-bulk-update",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const body = {
  status: "done",
  items: [
    { id: 11, original: { content: "Inbox 11", status: "pending", result: null } },
    { id: 12, original: { content: "Inbox 12", status: "pending", result: "メモ" } },
  ],
};

test("Inboxを更新前スナップショット付きで一括変更する", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: URL; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    seen.push({ url, body: requestBody });
    const id = Number(url.searchParams.get("id")?.replace("eq.", ""));
    return Response.json([{ id, ...requestBody }]);
  };
  try {
    const response = await inboxBulkRoute({ request: request(body), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "done", updated: [11, 12], failed: [] });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url.searchParams.get("content"), "eq.Inbox 11");
    assert.equal(seen[1].url.searchParams.get("result"), "eq.メモ");
    assert.deepEqual(seen.map(({ body: item }) => item.status), ["done", "done"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("競合したInboxだけを失敗として返し、成功IDを明示する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const id = Number(new URL(String(input)).searchParams.get("id")?.replace("eq.", ""));
    return id === 12 ? Response.json([]) : Response.json([{ id, ...JSON.parse(String(init?.body)) }]);
  };
  try {
    const response = await inboxBulkRoute({ request: request(body), env });
    assert.equal(response.status, 207);
    const result = await response.json() as { updated: number[]; failed: Array<{ id: number; error: string }> };
    assert.deepEqual(result.updated, [11]);
    assert.deepEqual(result.failed.map((item) => item.id), [12]);
    assert.match(result.failed[0].error, /別の画面で更新/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("一括更新は送信元、件数、重複IDを検証する", async () => {
  const wrongOrigin = await inboxBulkRoute({
    request: request(body, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const empty = await inboxBulkRoute({ request: request({ status: "done", items: [] }), env });
  assert.equal(empty.status, 400);

  const duplicate = await inboxBulkRoute({
    request: request({ status: "done", items: [body.items[0], body.items[0]] }),
    env,
  });
  assert.equal(duplicate.status, 400);
});
