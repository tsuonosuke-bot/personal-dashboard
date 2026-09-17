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
    method: "PATCH",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Wantを編集前の値との一致を条件に更新する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: 10, content: "更新後のWant", status: "completed" }]);
  };
  try {
    const response = await wantRoute({
      request: request("wants", "want-update", {
        id: 10,
        content: "  更新後のWant  ",
        status: "completed",
        original: { content: "更新前のWant", status: "active" },
      }),
      env,
    });
    assert.equal(response.status, 200);
    const endpoint = new URL(seenUrl);
    assert.equal(endpoint.pathname, "/rest/v1/wants");
    assert.equal(endpoint.searchParams.get("id"), "eq.10");
    assert.equal(endpoint.searchParams.get("content"), "eq.更新前のWant");
    assert.equal(endpoint.searchParams.get("status"), "eq.active");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), { content: "更新後のWant", status: "completed" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Next Actionを編集し、不正なステータスは拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ id: 20, want_id: 10, content: "更新後", status: "done" }]);
  try {
    const body = {
      id: 20,
      content: "更新後",
      status: "done",
      original: { content: "更新前", status: "open" },
    };
    const accepted = await actionRoute({ request: request("actions", "action-update", body), env });
    assert.equal(accepted.status, 200);

    const rejected = await actionRoute({
      request: request("actions", "action-update", { ...body, status: "deleted" }),
      env,
    });
    assert.equal(rejected.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("別画面で更新済みのWantと異なるOriginを拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const body = {
      id: 10,
      content: "更新後",
      status: "active",
      original: { content: "更新前", status: "active" },
    };
    const conflict = await wantRoute({ request: request("wants", "want-update", body), env });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: "このWantは別の画面で更新されています。再読み込みしてからやり直してください。",
    });

    const wrongOrigin = await wantRoute({
      request: request("wants", "want-update", body, { Origin: "https://attacker.example" }),
      env,
    });
    assert.equal(wrongOrigin.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
