/** Google event reads and mutations; preserves the public Calendar module exports. */
import { type DashboardEnv, DashboardError } from "./dashboard.ts";
import { forgetGoogleAccessToken, configured, refreshAccessToken } from "./googleCalendarConnection.ts";
import {
  CALENDAR_API,
  type GoogleCalendarEventSnapshot,
  isPlainObject,
  snapshotFromEvent,
  type GoogleEventShape,
  type CalendarSchedule,
  schedulePayload,
  expectedEvent,
  type GoogleEventResult,
  matchesEvent,
  validGoogleUrl,
  type GoogleCalendarListedEvent,
  listedEventSchedule,
} from "./googleCalendarModel.ts";

async function fetchGoogleCalendarEvent(accessToken: string, targetId: string): Promise<GoogleCalendarEventSnapshot> {
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(targetId)}`);
  endpoint.searchParams.set("fields", "id,etag,htmlLink,status,summary,start,end");
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not read the Google event.");
  }
  if (response.status === 404 || response.status === 410) {
    return { targetId, targetUrl: null, title: null, status: "missing", schedule: null, etag: null };
  }
  if (!response.ok) {
    if (response.status === 401) forgetGoogleAccessToken();
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
  }
  const event: unknown = await response.json();
  if (!isPlainObject(event) || event.id !== targetId) {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar returned an unexpected event.");
  }
  return snapshotFromEvent(targetId, event as GoogleEventShape);
}

export async function readGoogleCalendarEvents(
  env: DashboardEnv,
  targetIds: string[],
  pendingAccessToken?: Promise<string>,
): Promise<Map<string, GoogleCalendarEventSnapshot>> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const uniqueIds = [...new Set(targetIds.filter((id) => id.trim().length > 0))];
  if (uniqueIds.length === 0) return new Map();
  const accessToken = await (pendingAccessToken ?? refreshAccessToken(env));
  const snapshots = await Promise.all(uniqueIds.map((id) => fetchGoogleCalendarEvent(accessToken, id)));
  return new Map(snapshots.map((snapshot) => [snapshot.targetId, snapshot]));
}

export async function rescheduleGoogleCalendarEvent(
  env: DashboardEnv,
  targetId: string,
  schedule: CalendarSchedule,
  expectedEtag: string | null,
): Promise<GoogleCalendarEventSnapshot> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const accessToken = await refreshAccessToken(env);
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(targetId)}`);
  endpoint.searchParams.set("sendUpdates", "none");
  endpoint.searchParams.set("fields", "id,etag,htmlLink,status,summary,start,end");
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (expectedEtag) requestHeaders["If-Match"] = expectedEtag;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify(schedulePayload(schedule)),
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not reschedule the Google event.");
  }
  if (response.status === 404 || response.status === 410) {
    throw new DashboardError("GOOGLE_CALENDAR_EVENT_MISSING", "Google Calendar event no longer exists.", 409);
  }
  if (response.status === 412) {
    throw new DashboardError("GOOGLE_CALENDAR_EVENT_CONFLICT", "Google Calendar event changed before rescheduling.", 409);
  }
  if (!response.ok) {
    if (response.status === 401) forgetGoogleAccessToken();
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
  }
  const event: unknown = await response.json();
  if (!isPlainObject(event) || event.id !== targetId) {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar returned an unexpected event.");
  }
  const snapshot = snapshotFromEvent(targetId, event as GoogleEventShape);
  if (snapshot.status !== "confirmed" || !snapshot.schedule || JSON.stringify(snapshot.schedule) !== JSON.stringify(schedule)) {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar did not confirm the new schedule.");
  }
  return snapshot;
}

async function readVerifiedEvent(accessToken: string, expected: ReturnType<typeof expectedEvent>): Promise<GoogleEventResult> {
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(expected.id)}`);
  endpoint.searchParams.set("fields", "id,htmlLink,status,summary,start,end");
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not verify the Google event.");
  }
  if (!response.ok) {
    if (response.status === 401) forgetGoogleAccessToken();
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar verification returned ${response.status}.`);
  }
  const event: unknown = await response.json();
  if (!isPlainObject(event) || !matchesEvent(event as GoogleEventShape, expected) || !validGoogleUrl(event.htmlLink)) {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar returned an unexpected event.");
  }
  return { targetId: expected.id, targetUrl: event.htmlLink };
}

export async function createGoogleCalendarEvent(
  env: DashboardEnv,
  input: {
    wantId: number;
    idempotencyKey: string;
    title: string;
    detail: string | null;
    schedule: CalendarSchedule;
  },
): Promise<GoogleEventResult> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const accessToken = await refreshAccessToken(env);
  const event = expectedEvent(input.wantId, input.idempotencyKey, input.title, input.detail, input.schedule);
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events`);
  endpoint.searchParams.set("sendUpdates", "none");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not create the Google event.");
  }
  if (!response.ok && response.status !== 409) {
    if (response.status === 401) forgetGoogleAccessToken();
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
  }
  return readVerifiedEvent(accessToken, event);
}

export async function createReplacementGoogleCalendarEvent(
  env: DashboardEnv,
  input: {
    wantId: number;
    replacementKey: string;
    title: string;
    detail: string | null;
    schedule: CalendarSchedule;
  },
): Promise<GoogleCalendarEventSnapshot> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const accessToken = await refreshAccessToken(env);
  const event = expectedEvent(input.wantId, input.replacementKey, input.title, input.detail, input.schedule);
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events`);
  endpoint.searchParams.set("sendUpdates", "none");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not recreate the Google event.");
  }
  if (!response.ok && response.status !== 409) {
    if (response.status === 401) forgetGoogleAccessToken();
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
  }
  const verified = await readVerifiedEvent(accessToken, event);
  return fetchGoogleCalendarEvent(accessToken, verified.targetId);
}

const LIST_PAGE_LIMIT = 10;

/** primaryカレンダーの [timeMin, timeMax) を、取消済みも含めて列挙する。繰り返し予定は1回ずつに展開する。 */
export async function listGoogleCalendarEvents(
  env: DashboardEnv,
  timeMin: string,
  timeMax: string,
): Promise<{ events: GoogleCalendarListedEvent[]; complete: boolean }> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const accessToken = await refreshAccessToken(env);
  const events: GoogleCalendarListedEvent[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < LIST_PAGE_LIMIT; page += 1) {
    const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events`);
    endpoint.searchParams.set("singleEvents", "true");
    endpoint.searchParams.set("showDeleted", "true");
    endpoint.searchParams.set("timeMin", timeMin);
    endpoint.searchParams.set("timeMax", timeMax);
    endpoint.searchParams.set("maxResults", "250");
    endpoint.searchParams.set("fields", "nextPageToken,items(id,etag,htmlLink,status,summary,start,end)");
    if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
    let response: Response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    } catch {
      throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not list Google events.");
    }
    if (!response.ok) {
      if (response.status === 401) forgetGoogleAccessToken();
      const code = response.status === 401 || response.status === 403
        ? "GOOGLE_CALENDAR_ACCESS_DENIED"
        : response.status === 429
          ? "GOOGLE_CALENDAR_RATE_LIMITED"
          : "GOOGLE_CALENDAR_REQUEST_FAILED";
      throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
    }
    const payload: unknown = await response.json();
    if (!isPlainObject(payload) || !Array.isArray(payload.items)) {
      throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar returned invalid data.");
    }
    for (const item of payload.items) {
      if (!isPlainObject(item) || typeof item.id !== "string" || !item.id) continue;
      const cancelled = item.status === "cancelled";
      events.push({
        eventId: item.id,
        targetUrl: validGoogleUrl(item.htmlLink) ? item.htmlLink : null,
        title: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : null,
        status: cancelled ? "cancelled" : "confirmed",
        schedule: cancelled ? null : listedEventSchedule(item as GoogleEventShape),
        etag: typeof item.etag === "string" ? item.etag : null,
      });
    }
    pageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
    if (!pageToken) return { events, complete: true };
  }
  return { events, complete: false };
}

export {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_TIME_ZONE,
  type CalendarSchedule,
  type GoogleCalendarEventSnapshot,
  parseCalendarSchedule,
  type GoogleCalendarListedEvent,
  listedEventSchedule,
} from "./googleCalendarModel.ts";

export {
  type GoogleCalendarConnectionStatus,
  encryptGoogleCalendarRefreshToken,
  getGoogleCalendarConnectionStatus,
  assertGoogleCalendarConnected,
  startGoogleCalendarOAuth,
  handleGoogleCalendarOAuthCallback,
  forgetGoogleAccessToken,
  googleAccessToken,
} from "./googleCalendarConnection.ts";
