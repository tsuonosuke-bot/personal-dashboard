import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encryptGoogleCalendarRefreshToken } from "../functions/_shared/googleCalendar.ts";
import { onRequest as inboxRouteEndpoint } from "../functions/api/inbox-route.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

const idempotencyKey = "a1b2c3d4-1234-4abc-8def-1234567890ab";
const schedule = { allDay: false, date: "2026-09-22", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/inbox-route", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-route",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    contract: "inbox-route-v1",
    exit: "writing",
    state: "completed",
    replayed: false,
    inbox: { id: 7, status: "done", result: "Writingへ振り分け" },
    want: { id: 10, status: "completed", type: "want", revisit_on: null },
    route: {
      id: 41,
      status: "created",
      title: "AIと思考力",
      detail: null,
      target_id: "3",
      target_url: "/writing/?id=3",
      destination_data: {},
    },
    project_id: null,
    ...overrides,
  };
}

test("Inboxの振り分けはroute_inbox_itemへそのまま渡し、結果を返す", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/rpc/route_inbox_item") return Response.json(rpcResult());
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const params = { expected: { content: "AIと思考力", result: null }, intent: "explore", title: "AIと思考力", detail: null };
    const response = await inboxRouteEndpoint({
      request: request({ inboxId: 7, exit: "writing", params, idempotencyKey }),
      env,
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.route.status, "created");
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      p_inbox_id: 7,
      p_exit: "writing",
      p_params: params,
      p_idempotency_key: idempotencyKey,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DB関数のエラーコードを公開用のメッセージとステータスへ対応させる", async () => {
  const originalFetch = globalThis.fetch;
  const cases: Array<[string, number, RegExp]> = [
    ["INBOX_ROUTE_CONFLICT", 409, /別の画面で更新/],
    ["FOCUS_ACTIVE_LIMIT", 409, /5件まで/],
    ["IDEMPOTENCY_CONFLICT", 409, /同じ処理ID/],
    ["INBOX_ROUTE_INVALID", 400, /入力内容/],
    ["PROJECT_SOURCE_ALREADY_LINKED", 409, /別のProject/],
  ];
  try {
    for (const [message, status, expected] of cases) {
      globalThis.fetch = async () => Response.json({ code: "P0001", message, details: null, hint: null }, { status: 400 });
      const response = await inboxRouteEndpoint({
        request: request({ inboxId: 7, exit: "focus", params: { expected: { content: "x" }, title: "x" }, idempotencyKey }),
        env,
      });
      assert.equal(response.status, status, message);
      assert.match((await response.json()).error, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("予定は記録後にGoogle Calendarへ作成し、complete_inbox_routeで確定する", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const eventId = `pd${idempotencyKey.replace(/-/g, "")}`;
  const awaiting = rpcResult({
    exit: "calendar",
    state: "awaiting_external",
    inbox: { id: 7, status: "pending", result: null },
    want: { id: 10, status: "active", type: "want", revisit_on: null },
    route: { id: 41, status: "planned", title: "調査時間を確保", detail: "60分", target_id: null, target_url: null, destination_data: { calendar: schedule } },
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/integration_connections")) {
      return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events", connected_at: "2026-09-20T00:00:00Z" }]);
    }
    if (url.pathname === "/rest/v1/rpc/route_inbox_item") return Response.json(awaiting);
    if (url.pathname === "/rest/v1/rpc/complete_inbox_route") {
      return Response.json(rpcResult({ exit: "calendar", inbox: { id: 7, status: "done", result: "Google Calendarへ振り分け" } }));
    }
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token", token_type: "Bearer", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com" && init?.method === "POST") return Response.json({ id: eventId });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith(`/${eventId}`)) {
      return Response.json({
        id: eventId,
        htmlLink: "https://calendar.google.com/calendar/event?eid=test",
        status: "confirmed",
        summary: "調査時間を確保",
        start: { dateTime: "2026-09-22T09:00:00+09:00", timeZone: "Asia/Tokyo" },
        end: { dateTime: "2026-09-22T10:00:00+09:00", timeZone: "Asia/Tokyo" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await inboxRouteEndpoint({
      request: request({
        inboxId: 7,
        exit: "calendar",
        params: { expected: { content: "調査時間", result: null }, intent: "act", title: "調査時間を確保", detail: "60分", calendar: schedule },
        idempotencyKey,
      }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inbox.status, "done");
    const insertion = requests.find((entry) => entry.url.hostname === "www.googleapis.com" && entry.init?.method === "POST");
    assert.equal(JSON.parse(String(insertion?.init?.body)).description, "60分\n\nPersonal Dashboard Want #10");
    const complete = requests.find((entry) => entry.url.pathname === "/rest/v1/rpc/complete_inbox_route");
    assert.deepEqual(JSON.parse(String(complete?.init?.body)), {
      p_idempotency_key: idempotencyKey,
      p_target_id: eventId,
      p_target_url: "https://calendar.google.com/calendar/event?eid=test",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Calendarの作成に失敗したらfail_inbox_routeで記録し、Inboxは確定しない", async () => {
  const originalFetch = globalThis.fetch;
  const called: string[] = [];
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    called.push(url.pathname);
    if (url.pathname.endsWith("/integration_connections")) {
      return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events", connected_at: "2026-09-20T00:00:00Z" }]);
    }
    if (url.pathname === "/rest/v1/rpc/route_inbox_item") {
      return Response.json(rpcResult({
        exit: "calendar",
        state: "awaiting_external",
        route: { id: 41, status: "planned", title: "予定", detail: null, target_id: null, target_url: null, destination_data: { calendar: schedule } },
      }));
    }
    if (url.pathname === "/rest/v1/rpc/fail_inbox_route") {
      assert.equal(JSON.parse(String(init?.body)).p_error_code, "GOOGLE_CALENDAR_REQUEST_FAILED");
      return Response.json(rpcResult({ exit: "calendar", state: "failed" }));
    }
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token", token_type: "Bearer", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com") return new Response("error", { status: 500 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await inboxRouteEndpoint({
      request: request({
        inboxId: 7,
        exit: "calendar",
        params: { expected: { content: "予定" }, title: "予定", calendar: schedule },
        idempotencyKey,
      }),
      env,
    });
    assert.equal(response.status, 502);
    assert.ok(called.includes("/rest/v1/rpc/fail_inbox_route"));
    assert.ok(!called.includes("/rest/v1/rpc/complete_inbox_route"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("不正な出口・処理ID・Origin・日時なしの予定はDBへ送らず拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`Unexpected request: ${input}`);
  };
  try {
    const base = { inboxId: 7, exit: "wish", params: { expected: { content: "x" } }, idempotencyKey };
    for (const body of [
      { ...base, exit: "unknown" },
      { ...base, idempotencyKey: "not-a-uuid" },
      { ...base, inboxId: 0 },
      { ...base, params: [] },
      { ...base, extra: true },
      { ...base, exit: "calendar", params: { expected: { content: "x" }, title: "x" } },
    ]) {
      const response = await inboxRouteEndpoint({ request: request(body), env });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    const foreign = await inboxRouteEndpoint({ request: request(base, { Origin: "https://evil.example" }), env });
    assert.equal(foreign.status, 403);
    const noHeader = await inboxRouteEndpoint({ request: request(base, { "X-Dashboard-Action": "inbox-update" }), env });
    assert.equal(noHeader.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrationは振り分けをDB関数に集約し、service_roleだけに実行を許可する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609230001_inbox_route_rpc.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists idempotency_key uuid/);
  assert.match(sql, /'contract', 'inbox-route-v1'/);
  for (const fn of ["route_inbox_item", "complete_inbox_route", "fail_inbox_route"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?security invoker`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
  }
  assert.doesNotMatch(sql, /security definer/);
});
