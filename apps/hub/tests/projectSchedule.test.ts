import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { onRequest } from "../functions/api/project-schedule.ts";
import {
  normalizeProjectScheduleOperation,
  projectScheduleEventId,
  readProjectScheduleInput,
} from "../functions/_shared/projectSchedule.ts";
import {
  encryptGoogleCalendarRefreshToken,
  forgetGoogleAccessToken,
} from "../functions/_shared/googleCalendarConnection.ts";
import { schedulePayload } from "../functions/_shared/googleCalendarModel.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-test-secret",
  GOOGLE_OAUTH_CLIENT_ID: "client",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};
const stamp = "2026-10-27T00:00:00.123456+00:00";
const requestId = "a1b2c3d4-1234-4abc-8def-1234567890ab";
const calendar = {
  allDay: false,
  date: "2026-11-04",
  startTime: "09:00",
  endTime: "10:00",
  timeZone: "Asia/Tokyo" as const,
};
const input = {
  actionId: 11,
  actionUpdatedAt: stamp,
  projectUpdatedAt: stamp,
  requestId,
  content: "申し込む",
  calendar,
};
function request(value: unknown = input, header = "project-schedule-create") {
  return new Request("https://hub.example/api/project-schedule", {
    method: "POST",
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": header,
    },
    body: JSON.stringify(value),
  });
}
function operation() {
  return {
    request_id: requestId,
    action_id: 11,
    project_id: 1,
    action_updated_at: stamp,
    project_updated_at: stamp,
    content: input.content,
    calendar,
    stage: "planned",
    event_id: projectScheduleEventId(requestId),
    calendar_url: null as string | null,
    calendar_etag: null as string | null,
    todo_id: null as number | null,
    error_code: null as string | null,
  };
}
type Scenario =
  | "ok"
  | "calendar-timeout"
  | "record-fail"
  | "record-response-loss"
  | "save-fail"
  | "save-response-loss"
  | "link-conflict"
  | "link-response-loss"
  | "auth-loss"
  | "begin-conflict";
async function harness(
  scenario: Scenario,
  run: (state: {
    calls: string[];
    op: ReturnType<typeof operation> | null;
    event: Record<string, unknown> | null;
    eventCreates: number;
    todoCreates: number;
    failed: boolean;
  }) => Promise<void>,
) {
  const original = globalThis.fetch;
  forgetGoogleAccessToken();
  const encrypted = await encryptGoogleCalendarRefreshToken("refresh-test-token", env);
  const state = {
    calls: [] as string[],
    op: null as ReturnType<typeof operation> | null,
    event: null as Record<string, unknown> | null,
    eventCreates: 0,
    todoCreates: 0,
    failed: false,
  };
  globalThis.fetch = async (source, init) => {
    const url = new URL(String(source));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}`);
    const body = String(init?.body ?? "").startsWith("{") ? JSON.parse(String(init!.body)) : {};
    if (url.pathname.endsWith("/integration_connections"))
      return Response.json([
        {
          provider: "google_calendar",
          encrypted_credentials: encrypted,
          scope: "https://www.googleapis.com/auth/calendar.events",
          connected_at: stamp,
        },
      ]);
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "test-access-token", expires_in: 0 });
    if (url.hostname === "www.googleapis.com") {
      if (scenario === "auth-loss" && !state.failed) {
        state.failed = true;
        return new Response("denied", { status: 401 });
      }
      if (method === "POST") {
        if (state.event) return new Response("already exists", { status: 409 });
        state.eventCreates++;
        assert.equal(body.id, projectScheduleEventId(requestId));
        assert.equal(body.summary, input.content);
        assert.match(body.description, /Project #1 \/ Action #11/);
        assert.doesNotMatch(body.description, /Want/);
        assert.equal(url.searchParams.get("sendUpdates"), "none");
        state.event = {
          ...body,
          status: "confirmed",
          etag: '"etag-1"',
          htmlLink: "https://calendar.google.com/calendar/event?eid=test",
        };
        if (scenario === "calendar-timeout" && !state.failed) {
          state.failed = true;
          throw new Error("response lost after creation");
        }
        return Response.json(state.event);
      }
      return state.event ? Response.json(state.event) : new Response("missing", { status: 404 });
    }
    if (url.pathname.endsWith("/project_schedule_operations"))
      return Response.json(state.op ? [state.op] : []);
    if (url.pathname.endsWith("/begin_project_schedule")) {
      if (scenario === "begin-conflict")
        return Response.json({ message: "ACTION_CONFLICT" }, { status: 400 });
      if (
        state.op &&
        (body.p_request.requestId !== state.op.request_id ||
          body.p_request.content !== state.op.content ||
          JSON.stringify(body.p_request.calendar) !== JSON.stringify(state.op.calendar))
      ) {
        return Response.json({ message: "SCHEDULE_REQUEST_CONFLICT" }, { status: 400 });
      }
      state.op ??= operation();
      return Response.json(state.op);
    }
    assert.ok(state.op);
    if (url.pathname.endsWith("/fail_project_schedule")) {
      if (state.op.stage !== "linked") state.op.error_code = body.p_error_code;
      return new Response("null");
    }
    if (url.pathname.endsWith("/record_project_schedule_calendar")) {
      if (scenario === "record-fail" && !state.failed) {
        state.failed = true;
        return new Response("database temporarily unavailable", { status: 500 });
      }
      assert.equal(body.p_event_id, state.op.event_id);
      assert.equal(body.p_calendar_etag, '"etag-1"');
      if (state.op.stage === "planned")
        Object.assign(state.op, {
          stage: "calendar_created",
          calendar_url: body.p_calendar_url,
          calendar_etag: body.p_calendar_etag,
        });
      if (scenario === "record-response-loss" && !state.failed) {
        state.failed = true;
        throw new Error("response lost after calendar metadata commit");
      }
      return Response.json(state.op);
    }
    if (url.pathname.endsWith("/save_project_schedule_todo")) {
      if (scenario === "save-fail" && !state.failed) {
        state.failed = true;
        return new Response("database temporarily unavailable", { status: 500 });
      }
      if (state.op.todo_id === null) {
        state.todoCreates++;
        Object.assign(state.op, { stage: "todo_created", todo_id: 71 });
      }
      if (scenario === "save-response-loss" && !state.failed) {
        state.failed = true;
        throw new Error("response lost after ToDo commit");
      }
      return Response.json(state.op);
    }
    if (url.pathname.endsWith("/finish_project_schedule")) {
      if (scenario === "link-conflict" && !state.failed) {
        state.failed = true;
        return Response.json({ message: "TODO_ALREADY_LINKED" }, { status: 400 });
      }
      Object.assign(state.op, { stage: "linked", error_code: null });
      if (scenario === "link-response-loss" && !state.failed) {
        state.failed = true;
        throw new Error("response lost after commit");
      }
      return Response.json(state.op);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await run(state);
  } finally {
    globalThis.fetch = original;
    forgetGoogleAccessToken();
  }
}

test("予定作成入力は最新snapshot・日付時刻・JST・UUID・未知キーを検証し、小数秒を保持", async () => {
  const valid = await readProjectScheduleInput(request(input));
  assert.ok(valid.ok);
  if (valid.ok) assert.equal(valid.value.actionUpdatedAt, stamp);
  for (const invalid of [
    { ...input, actionId: "11" },
    { ...input, requestId: "x" },
    { ...input, actionUpdatedAt: "yesterday" },
    { ...input, content: " " },
    { ...input, extra: true },
    { ...input, calendar: { ...calendar, timeZone: "UTC" } },
    { ...input, calendar: { ...calendar, date: "2026-02-30" } },
    { ...input, calendar: { ...calendar, endTime: "08:00" } },
  ]) {
    assert.equal((await readProjectScheduleInput(request(invalid))).ok, false);
  }
  assert.equal(
    (await readProjectScheduleInput(request({ ...input, content: "a".repeat(7000) }))).status,
    413,
  );
});

test("GETは保存済み操作だけ読み、キャンセル相当のGET・不正POSTでCalendarもToDoも作らない", async () => {
  await harness("ok", async (state) => {
    const response = await onRequest({
      env,
      request: new Request("https://hub.example/api/project-schedule?actionId=11"),
    });
    assert.deepEqual(await response.json(), { operation: null });
    assert.equal((await onRequest({ env, request: request(input, "wrong") })).status, 403);
    for (const query of [
      "actionId=1&actionId=2",
      "actionId=-1",
      "actionId=NaN",
      "actionId=1&extra=true",
    ]) {
      assert.equal(
        (
          await onRequest({
            env,
            request: new Request(`https://hub.example/api/project-schedule?${query}`),
          })
        ).status,
        400,
      );
    }
    assert.equal(state.eventCreates, 0);
    assert.equal(state.todoCreates, 0);
    assert.equal(state.calls.length, 1);
  });
});

test("確定保存はdurable intent→Calendar照合→ETag保存→ToDo→原子リンクの順で元Inbox/Wantを触らない", async () => {
  await harness("ok", async (state) => {
    const response = await onRequest({ env, request: request() });
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      operation: { stage: string; todoId: number; calendarEtag: string };
    };
    assert.equal(result.operation.stage, "linked");
    assert.equal(result.operation.todoId, 71);
    assert.equal(result.operation.calendarEtag, '"etag-1"');
    assert.ok(state.calls[0].endsWith("/begin_project_schedule"));
    assert.equal(state.eventCreates, 1);
    assert.equal(state.todoCreates, 1);
    assert.ok(!state.calls.some((call) => /want|idea_inbox|DELETE|PATCH/.test(call)));
    const beforeReplay = state.calls.length;
    assert.equal((await onRequest({ env, request: request() })).status, 200);
    assert.equal(state.calls.length, beforeReplay + 1);
  });
});

for (const scenario of [
  "calendar-timeout",
  "record-fail",
  "record-response-loss",
  "save-fail",
  "save-response-loss",
  "link-conflict",
  "link-response-loss",
  "auth-loss",
] as const) {
  test(`部分成功/結果不明 ${scenario}: 再訪問・同じ操作再送でCalendar/ToDoを増やさず回復`, async () => {
    await harness(scenario, async (state) => {
      const first = await onRequest({ env, request: request() });
      assert.ok(first.status >= 400);
      const failure = (await first.json()) as {
        operation: { requestId: string; stage: string };
        resultUnknown: boolean;
      };
      assert.equal(failure.operation.requestId, requestId);
      assert.equal(
        failure.operation.stage,
        scenario === "link-response-loss"
          ? "linked"
          : ["link-conflict", "save-response-loss"].includes(scenario)
            ? "todo_created"
            : ["save-fail", "record-response-loss"].includes(scenario)
              ? "calendar_created"
              : "planned",
      );
      const revisit = await onRequest({
        env,
        request: new Request("https://hub.example/api/project-schedule?actionId=11"),
      });
      assert.equal(
        ((await revisit.json()) as { operation: { requestId: string } }).operation.requestId,
        requestId,
      );
      const retry = await onRequest({ env, request: request() });
      assert.equal(retry.status, 200);
      assert.equal(
        ((await retry.json()) as { operation: { stage: string } }).operation.stage,
        "linked",
      );
      assert.equal(state.eventCreates, 1);
      assert.equal(state.todoCreates, 1);
    });
  });
}

test("作成前の同時Action変更は外部作成前に409、新しいキーは既存操作を置き換えない", async () => {
  await harness("begin-conflict", async (state) => {
    assert.equal((await onRequest({ env, request: request() })).status, 409);
    assert.equal(state.eventCreates, 0);
  });
  await harness("ok", async (state) => {
    await onRequest({ env, request: request() });
    assert.equal(
      (
        await onRequest({
          env,
          request: request({ ...input, requestId: "b1b2c3d4-1234-4abc-8def-1234567890ab" }),
        })
      ).status,
      409,
    );
    assert.equal(state.eventCreates, 1);
    assert.equal(state.todoCreates, 1);
  });
});

test("同じ操作の並行HTTP送信でも一つのCalendar ID・ToDoへ収束する", async () => {
  await harness("ok", async (state) => {
    const results = await Promise.all([
      onRequest({ env, request: request() }),
      onRequest({ env, request: request() }),
    ]);
    for (const result of results) assert.equal(result.status, 200);
    assert.equal(state.eventCreates, 1);
    assert.equal(state.todoCreates, 1);
    assert.equal(state.op?.stage, "linked");
  });
});

test("既知の作成済みCalendarが消えた場合は同じIDでも再作成しない", async () => {
  await harness("link-conflict", async (state) => {
    await onRequest({ env, request: request() });
    state.event = null;
    const response = await onRequest({ env, request: request() });
    assert.equal(response.status, 409);
    assert.equal(state.eventCreates, 1);
    assert.equal(state.todoCreates, 1);
    assert.equal(state.op?.stage, "todo_created");
  });
});

test("既存Calendarの文言・日程・ETag変更を検知し、上書き・削除・別イベント作成をしない", async () => {
  for (const change of [
    { summary: "changed" },
    { ...schedulePayload({ ...calendar, startTime: "10:00", endTime: "11:00" }) },
    { etag: '"changed-etag"' },
  ]) {
    await harness("link-conflict", async (state) => {
      await onRequest({ env, request: request() });
      Object.assign(state.event!, change);
      const response = await onRequest({ env, request: request() });
      assert.equal(response.status, 409);
      assert.equal(state.op?.stage, "todo_created");
      assert.equal(state.eventCreates, 1);
      assert.equal(state.todoCreates, 1);
      assert.ok(!state.calls.some((call) => /PATCH|DELETE/.test(call)));
    });
  }
});

test("不正な操作応答とETag欠落を拒否する", () => {
  assert.equal(normalizeProjectScheduleOperation(operation()).actionUpdatedAt, stamp);
  assert.throws(
    () => normalizeProjectScheduleOperation({ ...operation(), stage: "linked" }),
    /Incomplete/,
  );
  assert.throws(
    () => normalizeProjectScheduleOperation({ ...operation(), event_id: "other" }),
    /Invalid/,
  );
});

test("DB契約は既存正本リンク・1:1・RLS・再実行を保持し、元Want/Inbox/Nextを変更しない", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261027030003_project_action_schedule.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /action_id bigint not null unique/);
  assert.match(sql, /todo_id bigint unique/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /on conflict\(google_event_id\) do nothing/);
  assert.match(sql, /public\.link_project_action_todo/);
  assert.match(sql, /v_todo\.calendar_etag is distinct from v_op\.calendar_etag/);
  assert.doesNotMatch(
    sql,
    /(?:update|insert into|delete from) public\.(?:wants|idea_inbox|want_routes)/i,
  );
  assert.doesNotMatch(sql, /update public\.project_actions set status/i);
});
