import assert from "node:assert/strict";
import test from "node:test";
import { encryptGoogleCalendarRefreshToken } from "../functions/_shared/googleCalendar.ts";
import { onRequest as routeEndpoint } from "../functions/api/want-routes.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

const idempotencyKey = "a1b2c3d4-1234-4abc-8def-1234567890ab";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/want-routes", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "want-route-create",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    wantId: 10,
    intent: "explore",
    destination: "writing",
    title: "AIと思考力について書く",
    detail: "AIは思考力を高めるのか",
    cadence: null,
    idempotencyKey,
    original: { content: "AIと思考力について考えたい", status: "active" },
    ...overrides,
  };
}

function routeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    want_id: 10,
    intent: "explore",
    destination: "writing",
    status: "planned",
    title: "AIと思考力について書く",
    detail: "AIは思考力を高めるのか",
    cadence: null,
    target_id: null,
    target_url: null,
    error_code: null,
    destination_data: {},
    idempotency_key: idempotencyKey,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

test("Writingへの振り分けを内部登録し、確認済みの対象IDを返す", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "POST") return Response.json([routeRow()]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      return Response.json([routeRow({ status: "created", target_id: "71" })]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([]);
    if (url.pathname.endsWith("/writing_topics")) return Response.json([{ id: 71 }]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.status, "created");
    assert.equal(payload.targetId, "71");
    const writing = requests.find((entry) => entry.url.pathname.endsWith("/writing_topics"));
    assert.ok(writing);
    assert.deepEqual(JSON.parse(String(writing.init?.body)), {
      source_route_id: 41,
      source_want_id: 10,
      title: "AIと思考力について書く",
      question: "AIは思考力を高めるのか",
      status: "candidate",
    });
    assert.ok(requests.every((entry) => (entry.init?.headers as Record<string, string> | undefined)?.apikey === "secret-test-key"));
    assert.ok(!requests.some((entry) => entry.url.pathname.includes("calendar") || entry.url.hostname.includes("google")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Calendarは明示確認後に予定を作成し、再取得した正本を保存する", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const schedule = { allDay: false, date: "2026-09-22", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" };
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const eventId = `pd${idempotencyKey.replace(/-/g, "")}`;
  const calendarRow = routeRow({
    intent: "act",
    destination: "calendar",
    title: "調査時間を確保",
    detail: "60分",
    destination_data: { calendar: schedule },
  });
  let routePatchCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/integration_connections")) {
      return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events", connected_at: "2026-09-20T00:00:00Z" }]);
    }
    if (url.pathname.endsWith("/want_routes") && init?.method === "POST") return Response.json([calendarRow]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      routePatchCount += 1;
      return Response.json([routeRow({
        ...calendarRow,
        status: "created",
        target_id: eventId,
        target_url: "https://calendar.google.com/calendar/event?eid=test",
      })]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([]);
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
    const response = await routeEndpoint({
      request: request(body({ intent: "act", destination: "calendar", title: "調査時間を確保", detail: "60分", calendar: schedule })),
      env,
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.status, "created");
    assert.equal(payload.targetId, eventId);
    assert.equal(routePatchCount, 1);
    const insertion = requests.find((entry) => entry.url.hostname === "www.googleapis.com" && entry.init?.method === "POST");
    assert.ok(insertion);
    assert.deepEqual(JSON.parse(String(insertion.init?.body)), {
      id: eventId,
      summary: "調査時間を確保",
      description: "60分\n\nPersonal Dashboard Want #10",
      start: { dateTime: "2026-09-22T09:00:00+09:00", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-09-22T10:00:00+09:00", timeZone: "Asia/Tokyo" },
    });
    assert.ok(requests.some((entry) => entry.url.hostname === "www.googleapis.com" && entry.url.pathname.endsWith(`/${eventId}`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Calendarは日付・時間なしでは外部通信せず拒否する", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };
  try {
    const response = await routeEndpoint({
      request: request(body({ intent: "act", destination: "calendar", title: "調査時間を確保", calendar: null })),
      env,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Google Calendarへ登録する日付と時間を確認してください。" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Calendarは初回作成後の確認失敗から同じ処理IDで安全に再開する", async () => {
  const originalFetch = globalThis.fetch;
  const schedule = { allDay: false, date: "2026-09-22", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" };
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const eventId = `pd${idempotencyKey.replace(/-/g, "")}`;
  const calendarRow = routeRow({
    intent: "act",
    destination: "calendar",
    status: "failed",
    title: "調査時間を確保",
    detail: "60分",
    error_code: "GOOGLE_CALENDAR_UNAVAILABLE",
    destination_data: { calendar: schedule },
  });
  let routePatchCount = 0;
  let calendarInsertCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/integration_connections")) {
      return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events", connected_at: "2026-09-20T00:00:00Z" }]);
    }
    if (url.pathname.endsWith("/want_routes") && !init?.method) return Response.json([calendarRow]);
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      routePatchCount += 1;
      return routePatchCount === 1
        ? Response.json([{ ...calendarRow, status: "planned", error_code: null }])
        : Response.json([{ ...calendarRow, status: "created", target_id: eventId, target_url: "https://calendar.google.com/calendar/event?eid=test", error_code: null }]);
    }
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token", token_type: "Bearer", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com" && init?.method === "POST") {
      calendarInsertCount += 1;
      return new Response(null, { status: 409 });
    }
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
    const response = await routeEndpoint({
      request: request(body({ intent: "act", destination: "calendar", title: "調査時間を確保", detail: "60分", calendar: schedule })),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).targetId, eventId);
    assert.equal(calendarInsertCount, 1);
    assert.equal(routePatchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("同じ処理IDは既存の振り分けを返して二重登録しない", async () => {
  const originalFetch = globalThis.fetch;
  let routeReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/want_routes") && !init?.method) {
      routeReads += 1;
      return Response.json([routeRow({ status: "created", target_id: "71" })]);
    }
    throw new Error(`Unexpected write: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).targetId, "71");
    assert.equal(routeReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("同じ処理IDでも内容が異なる振り分けは競合として拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/want_routes") && !init?.method) {
      return Response.json([routeRow({ detail: "すでに保存した内容" })]);
    }
    throw new Error(`Unexpected write: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "この振り分けは別の画面で変更されています。再読み込みしてからやり直してください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("途中でfailedになった内部振り分けは同じ処理IDで安全に再開する", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10 }]);
    if (url.pathname.endsWith("/want_routes") && !init?.method) {
      return Response.json([routeRow({ status: "failed", error_code: "WANT_ROUTE_FAILED" })]);
    }
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      patchCount += 1;
      return patchCount === 1
        ? Response.json([routeRow({ status: "planned", error_code: null })])
        : Response.json([routeRow({ status: "created", target_id: "71", error_code: null })]);
    }
    if (url.pathname.endsWith("/writing_topics")) return Response.json([{ id: 71 }]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).status, "created");
    assert.equal(patchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("不正な組み合わせ、古いWant、異なるOriginを拒否する", async () => {
  const invalidCombination = await routeEndpoint({
    request: request(body({ intent: "continue", destination: "github" })),
    env,
  });
  assert.equal(invalidCombination.status, 400);

  const wrongOrigin = await routeEndpoint({
    request: request(body(), { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const conflict = await routeEndpoint({ request: request(body()), env });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "このWantは別の画面で更新されています。再読み込みしてからやり直してください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
