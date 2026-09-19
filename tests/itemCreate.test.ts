import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as wantRoute } from "../functions/api/wants.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function request(action: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/wants", {
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
      request: request("want-create", { content: "  新しいWant  " }),
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

test("不正なOrigin、余分な項目を拒否する", async () => {
  const wrongOrigin = await wantRoute({
    request: request("want-create", { content: "Want" }, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const extraField = await wantRoute({
    request: request("want-create", { content: "Want", status: "active" }),
    env,
  });
  assert.equal(extraField.status, 400);
});
