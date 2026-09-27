import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encryptGoogleCalendarRefreshToken } from "../functions/_shared/googleCalendar.ts";
import { onRequest as scheduledActionsEndpoint } from "../functions/api/scheduled-actions.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

const schedule = { allDay: false, date: "2099-09-22", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" } as const;
const rescheduled = { ...schedule, date: "2099-09-23", startTime: "13:00", endTime: "14:00" } as const;
const updatedAt = "2026-09-22T01:02:03.123456+00:00";

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    source_route_id: 41,
    status: "pending",
    current_schedule: schedule,
    completed_at: null,
    note: null,
    reschedule_count: 0,
    last_calendar_sync_at: null,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: updatedAt,
    ...overrides,
  };
}

function patchRequest(command: string, overrides: Record<string, unknown> = {}) {
  return new Request("https://dashboard.example/api/scheduled-actions", {
    method: "PATCH",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "scheduled-todo-update",
    },
    body: JSON.stringify({
      id: 7,
      command,
      note: null,
      schedule: command === "reschedule" || command === "recreate" ? rescheduled : null,
      original: { status: "pending", updatedAt, calendarEtag: '"etag-1"', schedule },
      ...overrides,
    }),
  });
}

test("Calendar化した予定をToDoとして現在のGoogle日時と一緒に返す", async () => {
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/scheduled_actions")) return Response.json([actionRow()]);
    if (url.pathname.endsWith("/want_routes")) return Response.json([{ id: 41, want_id: 10, title: "調査する", detail: "60分", target_id: "event-1", target_url: "https://calendar.google.com/calendar/event?eid=old" }]);
    if (url.pathname.endsWith("/wants")) return Response.json([{ id: 10, content: "調査したい", source_inbox_id: 3 }]);
    if (url.pathname.endsWith("/integration_connections")) return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events" }]);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token" });
    if (url.hostname === "www.googleapis.com") {
      return Response.json({
        id: "event-1",
        etag: '"etag-1"',
        htmlLink: "https://calendar.google.com/calendar/event?eid=live",
        status: "confirmed",
        summary: "Google側の現在タイトル",
        start: { dateTime: "2099-09-22T09:00:00+09:00" },
        end: { dateTime: "2099-09-22T10:00:00+09:00" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await scheduledActionsEndpoint({ request: new Request("https://dashboard.example/api/scheduled-actions"), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.summary.pending, 1);
    assert.equal(payload.items[0].title, "Google側の現在タイトル");
    assert.deepEqual(payload.items[0].schedule, schedule);
    assert.equal(payload.items[0].calendarState, "confirmed");
    assert.equal(payload.items[0].calendarEtag, '"etag-1"');
    assert.equal(payload.items[0].updatedAt, updatedAt);
    assert.ok(requests.every((entry) => entry.url.hostname !== "project.supabase.co" || (entry.init?.headers as Record<string, string>).apikey === "secret-test-key"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("日程変更は同じGoogle予定をETag付きで更新して履歴を残す", async () => {
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const originalFetch = globalThis.fetch;
  let calendarPatch = 0;
  let actionPatch = 0;
  let historyInsert = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/scheduled_actions") && !init?.method) {
      assert.equal(url.searchParams.get("updated_at"), `eq.${updatedAt}`);
      return Response.json([actionRow()]);
    }
    if (url.pathname.endsWith("/want_routes") && !init?.method) return Response.json([{ id: 41, want_id: 10, destination: "calendar", status: "created", target_id: "event-1", title: "調査する", detail: "60分" }]);
    if (url.pathname.endsWith("/integration_connections")) return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events" }]);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token" });
    if (url.hostname === "www.googleapis.com" && init?.method === "PATCH") {
      calendarPatch += 1;
      assert.equal((init.headers as Record<string, string>)["If-Match"], '"etag-1"');
      assert.deepEqual(JSON.parse(String(init.body)), {
        start: { dateTime: "2099-09-23T13:00:00+09:00", timeZone: "Asia/Tokyo" },
        end: { dateTime: "2099-09-23T14:00:00+09:00", timeZone: "Asia/Tokyo" },
      });
      return Response.json({
        id: "event-1",
        etag: '"etag-2"',
        htmlLink: "https://calendar.google.com/calendar/event?eid=live",
        status: "confirmed",
        summary: "調査する",
        start: { dateTime: "2099-09-23T13:00:00+09:00" },
        end: { dateTime: "2099-09-23T14:00:00+09:00" },
      });
    }
    if (url.pathname.endsWith("/scheduled_actions") && init?.method === "PATCH") {
      actionPatch += 1;
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.current_schedule, rescheduled);
      assert.equal(body.reschedule_count, 1);
      return Response.json([actionRow({ current_schedule: rescheduled, reschedule_count: 1, updated_at: "2026-09-22T02:00:00Z" })]);
    }
    if (url.pathname.endsWith("/scheduled_action_schedule_history") && init?.method === "POST") {
      historyInsert += 1;
      assert.deepEqual(JSON.parse(String(init.body)), { scheduled_action_id: 7, previous_schedule: schedule, next_schedule: rescheduled });
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await scheduledActionsEndpoint({ request: patchRequest("reschedule"), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rescheduleCount, 1);
    assert.equal(calendarPatch, 1);
    assert.equal(actionPatch, 1);
    assert.equal(historyInsert, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("完了はToDoだけを競合安全に更新しGoogle Calendarを変更しない", async () => {
  const originalFetch = globalThis.fetch;
  let calendarCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname.includes("google")) calendarCalled = true;
    if (url.pathname.endsWith("/scheduled_actions") && !init?.method) return Response.json([actionRow()]);
    if (url.pathname.endsWith("/scheduled_actions") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.status, "completed");
      assert.equal(typeof body.completed_at, "string");
      return Response.json([actionRow({ status: "completed", completed_at: body.completed_at, updated_at: "2026-09-22T02:00:00Z" })]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await scheduledActionsEndpoint({ request: patchRequest("complete", { note: "実施済み" }), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "completed");
    assert.equal(calendarCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google側で先に変更された予定はETag競合として上書きしない", async () => {
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const originalFetch = globalThis.fetch;
  let localPatchCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/scheduled_actions") && !init?.method) return Response.json([actionRow()]);
    if (url.pathname.endsWith("/scheduled_actions") && init?.method === "PATCH") {
      localPatchCalled = true;
      return Response.json([]);
    }
    if (url.pathname.endsWith("/want_routes")) return Response.json([{ id: 41, want_id: 10, destination: "calendar", status: "created", target_id: "event-1", title: "調査する", detail: "60分" }]);
    if (url.pathname.endsWith("/integration_connections")) return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events" }]);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token" });
    if (url.hostname === "www.googleapis.com" && init?.method === "PATCH") return new Response(null, { status: 412 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await scheduledActionsEndpoint({ request: patchRequest("reschedule"), env });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "Google Calendar側で予定が変更されています。再読み込みしてから日程を決め直してください。" });
    assert.equal(localPatchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("削除済みCalendar予定は決定的な新規IDで再作成してToDoへ再接続する", async () => {
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-token", env);
  const originalFetch = globalThis.fetch;
  let replacementId = "";
  let routeReconnected = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/scheduled_actions") && !init?.method) return Response.json([actionRow()]);
    if (url.pathname.endsWith("/want_routes") && !init?.method) {
      return Response.json([{ id: 41, want_id: 10, destination: "calendar", status: "created", target_id: "old-event", title: "調査する", detail: "60分" }]);
    }
    if (url.pathname.endsWith("/integration_connections")) return Response.json([{ provider: "google_calendar", encrypted_credentials: encrypted, scope: "https://www.googleapis.com/auth/calendar.events" }]);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-token" });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/old-event")) return new Response(null, { status: 404 });
    if (url.hostname === "www.googleapis.com" && init?.method === "POST") {
      replacementId = JSON.parse(String(init.body)).id;
      assert.match(replacementId, /^pd[0-9a-f]{32}$/);
      return Response.json({ id: replacementId });
    }
    if (url.hostname === "www.googleapis.com" && replacementId && url.pathname.endsWith(`/${replacementId}`)) {
      return Response.json({
        id: replacementId,
        etag: '"replacement-etag"',
        htmlLink: "https://calendar.google.com/calendar/event?eid=replacement",
        status: "confirmed",
        summary: "調査する",
        start: { dateTime: "2099-09-23T13:00:00+09:00" },
        end: { dateTime: "2099-09-23T14:00:00+09:00" },
      });
    }
    if (url.pathname.endsWith("/want_routes") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.target_id, replacementId);
      routeReconnected = true;
      return Response.json([{ id: 41, target_id: replacementId }]);
    }
    if (url.pathname.endsWith("/scheduled_actions") && init?.method === "PATCH") {
      return Response.json([actionRow({ current_schedule: rescheduled, reschedule_count: 1, updated_at: "2026-09-22T03:00:00Z" })]);
    }
    if (url.pathname.endsWith("/scheduled_action_schedule_history") && init?.method === "POST") return new Response(null, { status: 201 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await scheduledActionsEndpoint({ request: patchRequest("recreate"), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rescheduleCount, 1);
    assert.equal(routeReconnected, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("古い日時への再調整と競合情報のない再調整を外部通信前に拒否する", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };
  try {
    const past = await scheduledActionsEndpoint({
      request: patchRequest("reschedule", { schedule: { ...schedule, date: "2020-01-01" } }),
      env,
    });
    assert.equal(past.status, 400);
    const stale = await scheduledActionsEndpoint({
      request: patchRequest("reschedule", { original: { status: "pending", updatedAt, calendarEtag: null, schedule } }),
      env,
    });
    assert.equal(stale.status, 409);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrationは既存Calendar振り分けをToDoへ移行し今後も自動作成する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609220004_scheduled_actions.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.scheduled_actions/i);
  assert.match(sql, /status in \('pending', 'completed', 'skipped'\)/i);
  assert.match(sql, /create trigger ensure_scheduled_action_after_calendar_route/i);
  assert.match(sql, /new\.destination = 'calendar'.*new\.status = 'created'/is);
  assert.match(sql, /insert into public\.scheduled_actions[\s\S]*from public\.want_routes/is);
  assert.match(sql, /on conflict \(source_route_id\) do nothing/i);
});
