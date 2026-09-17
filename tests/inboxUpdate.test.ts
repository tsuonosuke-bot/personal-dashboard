import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as inboxRoute } from "../functions/api/inbox.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

const validBody = {
  id: 42,
  content: "  更新後のInbox  ",
  status: "done",
  result: "  タスクへ移動  ",
  original: { content: "更新前のInbox", status: "pending", result: null },
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/inbox", {
    method: "PATCH",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-update",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Inboxを編集前の値との一致を条件に更新する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: 42, content: "更新後のInbox", status: "done", result: "タスクへ移動" }]);
  };
  try {
    const response = await inboxRoute({ request: request(validBody), env });
    assert.equal(response.status, 200);
    const endpoint = new URL(seenUrl);
    assert.equal(endpoint.searchParams.get("id"), "eq.42");
    assert.equal(endpoint.searchParams.get("content"), "eq.更新前のInbox");
    assert.equal(endpoint.searchParams.get("status"), "eq.pending");
    assert.equal(endpoint.searchParams.get("result"), "is.null");
    assert.equal(seenInit?.method, "PATCH");
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      content: "更新後のInbox",
      status: "done",
      result: "タスクへ移動",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("別画面で更新済みなら競合として返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const response = await inboxRoute({ request: request(validBody), env });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "このInboxは別の画面で更新されています。再読み込みしてからやり直してください。",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("更新元と入力項目を検証する", async () => {
  const wrongOrigin = await inboxRoute({
    request: request(validBody, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const invalidStatus = await inboxRoute({
    request: request({ ...validBody, status: "deleted" }),
    env,
  });
  assert.equal(invalidStatus.status, 400);
});
