import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as actionRoute } from "../functions/api/actions.ts";
import { onRequest as wantRoute } from "../functions/api/wants.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function request(path: "wants" | "actions", action: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://dashboard.example/api/${path}`, {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Inbox由来の内容をactive Wantとして登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: 51, content: "新しいWant", status: "active" }]);
  };
  try {
    const response = await wantRoute({
      request: request("wants", "want-create", { content: "  新しいWant  " }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(new URL(seenUrl).pathname, "/rest/v1/wants");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), { content: "新しいWant", status: "active" });
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wantに紐づくopen Next Actionを登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seenInit = init;
    return Response.json([{ id: 61, want_id: 51, content: "次にやること", status: "open" }]);
  };
  try {
    const response = await actionRoute({
      request: request("actions", "action-create", { wantId: 51, content: "  次にやること  " }),
      env,
    });
    assert.equal(response.status, 201);
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      want_id: 51,
      content: "次にやること",
      status: "open",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("不正なOrigin、余分な項目、Want IDを拒否する", async () => {
  const wrongOrigin = await wantRoute({
    request: request("wants", "want-create", { content: "Want" }, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const extraField = await wantRoute({
    request: request("wants", "want-create", { content: "Want", status: "active" }),
    env,
  });
  assert.equal(extraField.status, 400);

  const invalidWant = await actionRoute({
    request: request("actions", "action-create", { wantId: 0, content: "Action" }),
    env,
  });
  assert.equal(invalidWant.status, 400);
});
