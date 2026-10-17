import assert from "node:assert/strict";
import test from "node:test";
import { calendarSyncWindow, hasCalendarSyncCredential, planCalendarSync, type MirroredAction } from "../functions/_shared/calendarSync.ts";
import { listedEventSchedule, type GoogleCalendarListedEvent } from "../functions/_shared/googleCalendar.ts";
import { onRequest as calendarSyncEndpoint } from "../functions/api/calendar-sync.ts";

const schedule = { allDay: false, date: "2026-10-20", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Tokyo" } as const;
const now = "2026-10-18T00:00:00.000Z";
const SECRET = "s".repeat(32);

function event(overrides: Partial<GoogleCalendarListedEvent> = {}): GoogleCalendarListedEvent {
  return { eventId: "e1", targetUrl: "https://www.google.com/calendar/event?eid=1", title: "歯医者", status: "confirmed", schedule, etag: '"1"', ...overrides };
}

function mirrored(overrides: Partial<MirroredAction> = {}): MirroredAction {
  return { id: 5, googleEventId: "e1", status: "pending", schedule, title: "歯医者", url: "https://www.google.com/calendar/event?eid=1", etag: '"1"', calendarState: "confirmed", ...overrides };
}

test("新しい予定はミラー行として追加し、Dashboardから作った予定は飛ばす", () => {
  const plan = planCalendarSync([event(), event({ eventId: "routed" })], [], new Set(["routed"]), now);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].google_event_id, "e1");
  assert.equal(plan.inserts[0].calendar_title, "歯医者");
  assert.deepEqual(plan.updates, []);
});

test("変更がなければ何も書かない。日時やタイトルが変われば更新する", () => {
  assert.deepEqual(planCalendarSync([event()], [mirrored()], new Set(), now), { inserts: [], updates: [], deletes: [] });
  const moved = { ...schedule, date: "2026-10-21" };
  const plan = planCalendarSync([event({ schedule: moved, title: "歯医者(変更)" })], [mirrored()], new Set(), now);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0].changes.current_schedule, moved);
  assert.equal(plan.updates[0].changes.calendar_title, "歯医者(変更)");
  assert.equal("status" in plan.updates[0].changes, false);
});

test("取り消された予定は、未着手なら削除し、完了・見送り済みなら記録を残して取消にする", () => {
  const cancelled = event({ status: "cancelled", schedule: null });
  assert.deepEqual(planCalendarSync([cancelled], [mirrored()], new Set(), now).deletes, [5]);
  const done = planCalendarSync([cancelled], [mirrored({ status: "completed" })], new Set(), now);
  assert.deepEqual(done.deletes, []);
  assert.equal(done.updates[0].changes.calendar_state, "cancelled");
  assert.deepEqual(planCalendarSync([cancelled], [], new Set(), now), { inserts: [], updates: [], deletes: [] });
});

test("一覧に現れない行は窓の外へ動いただけの可能性があるので触らない", () => {
  assert.deepEqual(planCalendarSync([], [mirrored()], new Set(), now), { inserts: [], updates: [], deletes: [] });
});

test("複数日・日またぎの予定は開始日の1行に丸める", () => {
  assert.deepEqual(listedEventSchedule({ start: { date: "2026-10-20" }, end: { date: "2026-10-23" } }), {
    allDay: true, date: "2026-10-20", startTime: null, endTime: null, timeZone: "Asia/Tokyo",
  });
  assert.deepEqual(listedEventSchedule({ start: { dateTime: "2026-10-20T22:00:00+09:00" }, end: { dateTime: "2026-10-21T01:00:00+09:00" } }), {
    allDay: false, date: "2026-10-20", startTime: "22:00", endTime: "23:59", timeZone: "Asia/Tokyo",
  });
  assert.equal(listedEventSchedule({ start: { dateTime: "2026-10-20T23:59:00+09:00" }, end: { dateTime: "2026-10-21T01:00:00+09:00" } }), null);
});

test("同期の窓は東京の今日0時から90日先", () => {
  const window = calendarSyncWindow(new Date("2026-10-18T16:00:00Z"));
  assert.equal(window.timeMin, "2026-10-18T15:00:00.000Z");
  assert.equal(window.timeMax, "2027-01-16T15:00:00.000Z");
});

test("Bearerが32文字以上の共有シークレットと一致したときだけ通す", async () => {
  const request = (auth?: string) => new Request("https://dashboard.example/api/calendar-sync", { method: "POST", headers: auth ? { Authorization: auth } : {} });
  assert.equal(hasCalendarSyncCredential(request(`Bearer ${SECRET}`), { CALENDAR_SYNC_SECRET: SECRET }), true);
  assert.equal(hasCalendarSyncCredential(request(`Bearer ${"x".repeat(32)}`), { CALENDAR_SYNC_SECRET: SECRET }), false);
  assert.equal(hasCalendarSyncCredential(request(), { CALENDAR_SYNC_SECRET: SECRET }), false);
  assert.equal(hasCalendarSyncCredential(request("Bearer short"), { CALENDAR_SYNC_SECRET: "short" }), false);
  assert.equal(hasCalendarSyncCredential(request(`Bearer ${SECRET}`), {}), false);
  const denied = await calendarSyncEndpoint({ request: request("Bearer nope"), env: { CALENDAR_SYNC_SECRET: SECRET } });
  assert.equal(denied.status, 401);
  const wrongMethod = await calendarSyncEndpoint({ request: new Request("https://dashboard.example/api/calendar-sync"), env: { CALENDAR_SYNC_SECRET: SECRET } });
  assert.equal(wrongMethod.status, 405);
});
