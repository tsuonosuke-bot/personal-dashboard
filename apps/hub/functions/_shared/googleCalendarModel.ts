/** Calendar schedule validation and event mapping, independent of credentials and network access. */


export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Tokyo";

export interface CalendarSchedule {
  allDay: boolean;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timeZone: typeof GOOGLE_CALENDAR_TIME_ZONE;
}

export interface GoogleEventShape {
  id?: unknown;
  etag?: unknown;
  htmlLink?: unknown;
  status?: unknown;
  summary?: unknown;
  start?: unknown;
  end?: unknown;
}

export interface GoogleEventResult {
  targetId: string;
  targetUrl: string;
}

export interface GoogleCalendarEventSnapshot {
  targetId: string;
  targetUrl: string | null;
  title: string | null;
  status: "confirmed" | "cancelled" | "missing";
  schedule: CalendarSchedule | null;
  etag: string | null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function parseCalendarSchedule(value: unknown): CalendarSchedule | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["allDay", "date", "startTime", "endTime", "timeZone"])) return null;
  if (typeof value.allDay !== "boolean" || !isValidDate(value.date) || value.timeZone !== GOOGLE_CALENDAR_TIME_ZONE) return null;
  if (value.allDay) {
    if (value.startTime !== null || value.endTime !== null) return null;
  } else {
    if (!isValidTime(value.startTime) || !isValidTime(value.endTime) || minutes(value.endTime) <= minutes(value.startTime)) return null;
  }
  return {
    allDay: value.allDay,
    date: value.date,
    startTime: value.startTime as string | null,
    endTime: value.endTime as string | null,
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
  };
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function eventDateTime(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

export function schedulePayload(schedule: CalendarSchedule) {
  return {
    start: schedule.allDay
      ? { date: schedule.date }
      : { dateTime: eventDateTime(schedule.date, schedule.startTime!), timeZone: schedule.timeZone },
    end: schedule.allDay
      ? { date: nextDate(schedule.date) }
      : { dateTime: eventDateTime(schedule.date, schedule.endTime!), timeZone: schedule.timeZone },
  };
}

export function expectedEvent(
  wantId: number,
  idempotencyKey: string,
  title: string,
  detail: string | null,
  schedule: CalendarSchedule,
) {
  const description = [detail, `Personal Dashboard Want #${wantId}`].filter(Boolean).join("\n\n");
  return {
    id: `pd${idempotencyKey.replace(/-/g, "")}`,
    summary: title,
    description,
    ...schedulePayload(schedule),
  };
}

function tokyoDateTime(value: string): { date: string; time: string } | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  return isValidDate(date) && isValidTime(time) ? { date, time } : null;
}

function scheduleFromEvent(event: GoogleEventShape): CalendarSchedule | null {
  if (!isPlainObject(event.start) || !isPlainObject(event.end)) return null;
  if (isValidDate(event.start.date) && isValidDate(event.end.date)) {
    return { allDay: true, date: event.start.date, startTime: null, endTime: null, timeZone: GOOGLE_CALENDAR_TIME_ZONE };
  }
  if (typeof event.start.dateTime !== "string" || typeof event.end.dateTime !== "string") return null;
  const start = tokyoDateTime(event.start.dateTime);
  const end = tokyoDateTime(event.end.dateTime);
  if (!start || !end || start.date !== end.date || minutes(end.time) <= minutes(start.time)) return null;
  return {
    allDay: false,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
  };
}

export function snapshotFromEvent(targetId: string, event: GoogleEventShape): GoogleCalendarEventSnapshot {
  const status = event.status === "cancelled" ? "cancelled" : "confirmed";
  return {
    targetId,
    targetUrl: validGoogleUrl(event.htmlLink) ? event.htmlLink : null,
    title: typeof event.summary === "string" && event.summary.trim() ? event.summary : null,
    status,
    schedule: status === "confirmed" ? scheduleFromEvent(event) : null,
    etag: typeof event.etag === "string" ? event.etag : null,
  };
}

export function validGoogleUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"));
  } catch {
    return false;
  }
}

export function matchesEvent(actual: GoogleEventShape, expected: ReturnType<typeof expectedEvent>): boolean {
  if (actual.id !== expected.id || actual.status === "cancelled" || actual.summary !== expected.summary ||
      !isPlainObject(actual.start) || !isPlainObject(actual.end)) return false;
  if ("date" in expected.start) {
    return actual.start.date === expected.start.date && actual.end.date === expected.end.date;
  }
  const expectedEnd = "dateTime" in expected.end ? expected.end.dateTime : null;
  return typeof actual.start.dateTime === "string" && typeof actual.end.dateTime === "string" &&
    Date.parse(actual.start.dateTime) === Date.parse(expected.start.dateTime) &&
    typeof expectedEnd === "string" && Date.parse(actual.end.dateTime) === Date.parse(expectedEnd);
}

export interface GoogleCalendarListedEvent {
  eventId: string;
  targetUrl: string | null;
  title: string | null;
  status: "confirmed" | "cancelled";
  schedule: CalendarSchedule | null;
  etag: string | null;
}

/**
 * ToDoの1行に収まる形へ丸める。複数日の終日予定は初日、日をまたぐ時間指定の予定は
 * 開始日の23:59までとして扱う。
 */
export function listedEventSchedule(event: GoogleEventShape): CalendarSchedule | null {
  if (!isPlainObject(event.start) || !isPlainObject(event.end)) return null;
  if (isValidDate(event.start.date)) {
    return { allDay: true, date: event.start.date, startTime: null, endTime: null, timeZone: GOOGLE_CALENDAR_TIME_ZONE };
  }
  if (typeof event.start.dateTime !== "string" || typeof event.end.dateTime !== "string") return null;
  const start = tokyoDateTime(event.start.dateTime);
  const end = tokyoDateTime(event.end.dateTime);
  if (!start) return null;
  const endTime = end && end.date === start.date && minutes(end.time) > minutes(start.time) ? end.time : "23:59";
  if (minutes(endTime) <= minutes(start.time)) return null;
  return { allDay: false, date: start.date, startTime: start.time, endTime, timeZone: GOOGLE_CALENDAR_TIME_ZONE };
}

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
