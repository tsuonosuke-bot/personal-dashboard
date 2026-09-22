import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as routeEndpoint } from "../functions/api/want-routes.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

const knowledgeId = "6f1b2f5c-9a58-4a2f-8f0e-2b1d7a9c4e31";

function plannedRouteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    want_id: 67,
    intent: "explore",
    destination: "knowledge",
    status: "planned",
    title: "Microsoft Accessとはなんだったか",
    detail: null,
    cadence: null,
    target_id: null,
    target_url: null,
    error_code: null,
    destination_data: {},
    idempotency_key: "a1b2c3d4-1234-4abc-8def-1234567890ab",
    created_at: "2026-09-22T04:09:32Z",
    updated_at: "2026-09-22T04:09:32Z",
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/want-routes", {
    method: "PATCH",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "want-route-complete",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    routeId: 42,
    knowledgeId: null,
    original: { destination: "knowledge", status: "planned" },
    ...overrides,
  };
}

test("Knowledge候補を登録済みにし、登録待ちから外す", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      return Response.json([plannedRouteRow({ status: "created", target_id: "manual" })]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([plannedRouteRow()]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "created");
    assert.equal(payload.targetId, "manual");
    assert.equal(payload.targetUrl, null);
    const update = requests.find((entry) => entry.init?.method === "PATCH");
    assert.ok(update);
    assert.equal(update.url.searchParams.get("status"), "eq.planned");
    assert.equal(update.url.searchParams.get("destination"), "eq.knowledge");
    const sent = JSON.parse(String(update.init?.body));
    assert.equal(sent.status, "created");
    assert.equal(sent.target_id, "manual");
    assert.equal(sent.target_url, null);
    assert.ok(!requests.some((entry) => entry.url.pathname.endsWith("/wants")));
    assert.ok(!requests.some((entry) => entry.url.pathname.endsWith("/knowledge")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Knowledge IDを入力した場合はナレッジDBの存在を確認して正本へのリンクを残す", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/knowledge")) return Response.json([{ id: knowledgeId }]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      return Response.json([plannedRouteRow({
        status: "created",
        target_id: knowledgeId,
        target_url: `/knowledge/?knowledge=${knowledgeId}`,
      })]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([plannedRouteRow()]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body({ knowledgeId })), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.targetId, knowledgeId);
    assert.equal(payload.targetUrl, `/knowledge/?knowledge=${knowledgeId}`);
    const lookup = requests.find((entry) => entry.url.pathname.endsWith("/knowledge"));
    assert.ok(lookup);
    assert.equal(lookup.url.searchParams.get("id"), `eq.${knowledgeId}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ナレッジDBに無いKnowledge IDは登録済みにしない", async () => {
  const originalFetch = globalThis.fetch;
  let updated = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/knowledge")) return Response.json([]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      updated = true;
      return Response.json([plannedRouteRow({ status: "created" })]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([plannedRouteRow()]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body({ knowledgeId })), env });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "指定したKnowledge IDはナレッジDBに見つかりません。IDを確認してください。",
    });
    assert.equal(updated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("すでに登録済みの候補は同じ結果を返し、対象IDを書き換えない", async () => {
  const originalFetch = globalThis.fetch;
  let updated = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      updated = true;
      return Response.json([plannedRouteRow({ status: "created" })]);
    }
    if (url.pathname.endsWith("/want_routes")) {
      return Response.json([plannedRouteRow({ status: "created", target_id: knowledgeId })]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).targetId, knowledgeId);
    assert.equal(updated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Knowledge以外の振り分けはこの操作で完了できない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/want_routes")) {
      return Response.json([plannedRouteRow({ destination: "github", intent: "act" })]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("対象の候補が無ければ404を返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/want_routes")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "対象のKnowledge候補が見つかりません。再読み込みしてからやり直してください。",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ヘッダー・送信元・入力形式を検証する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Supabaseへ送信してはいけません"); };
  try {
    const missingHeader = await routeEndpoint({
      request: request(body(), { "X-Dashboard-Action": "want-route-create" }),
      env,
    });
    assert.equal(missingHeader.status, 403);

    const foreignOrigin = await routeEndpoint({
      request: request(body(), { Origin: "https://attacker.example" }),
      env,
    });
    assert.equal(foreignOrigin.status, 403);

    const invalidKnowledgeId = await routeEndpoint({
      request: request(body({ knowledgeId: "not-a-uuid" })),
      env,
    });
    assert.equal(invalidKnowledgeId.status, 400);

    const staleSnapshot = await routeEndpoint({
      request: request(body({ original: { destination: "knowledge", status: "created" } })),
      env,
    });
    assert.equal(staleSnapshot.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Idea画面は登録待ちのKnowledge候補だけに登録済み操作を出す", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(script, /route\.destination === "knowledge" && route\.status === "planned"/);
  assert.match(script, /data-knowledge-complete/);
  assert.match(script, /"X-Dashboard-Action": "want-route-complete"/);
});
