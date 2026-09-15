import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as inboxRoute } from "../functions/api/inbox.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/inbox", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-create",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Inboxをpendingとして1件登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seenInit = init;
    return Response.json([{ id: 42, content: "新しいメモ", status: "pending", result: null, created_at: "2026-09-15T00:00:00Z" }]);
  };
  try {
    const response = await inboxRoute({ request: request({ content: "  新しいメモ  " }), env });
    assert.equal(response.status, 201);
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
    assert.equal((seenInit?.headers as Record<string, string>).Prefer, "return=representation");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), { content: "新しいメモ", status: "pending" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("別オリジン、不明な項目、空のInboxを拒否する", async () => {
  const crossOrigin = await inboxRoute({
    request: request({ content: "memo" }, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(crossOrigin.status, 403);
  const unknown = await inboxRoute({ request: request({ content: "memo", status: "done" }), env });
  assert.equal(unknown.status, 400);
  const empty = await inboxRoute({ request: request({ content: "  " }), env });
  assert.equal(empty.status, 400);
});
