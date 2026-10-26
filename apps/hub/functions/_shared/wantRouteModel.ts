/** Want route contracts and stored-row mapping shared by validation, storage and orchestration. */
import { type CalendarSchedule, parseCalendarSchedule } from "./googleCalendar.ts";
import { DashboardError } from "./dashboard.ts";

export const MAX_REQUEST_CHARS = 8_000;

export const MAX_TITLE_CHARS = 240;

export const MAX_DETAIL_CHARS = 2_000;

export const ROUTE_DESTINATIONS = [
  "calendar",
  "github",
  "writing",
  "habit",
  "knowledge",
  "focus",
  "journal",
  "archive",
] as const;

export const ROUTE_INTENTS = ["act", "continue", "explore", "keep", "discard"] as const;

export const HABIT_CADENCES = ["daily", "weekdays", "weekly", "flexible"] as const;

export type RouteDestination = typeof ROUTE_DESTINATIONS[number];

export type RouteIntent = typeof ROUTE_INTENTS[number];

export type HabitCadence = typeof HABIT_CADENCES[number];

export const destinationSet = new Set<string>(ROUTE_DESTINATIONS);

export const intentSet = new Set<string>(ROUTE_INTENTS);

export const cadenceSet = new Set<string>(HABIT_CADENCES);

export const allowedDestinationsByIntent: Record<RouteIntent, ReadonlySet<RouteDestination>> = {
  act: new Set(["calendar", "github"]),
  continue: new Set(["habit"]),
  explore: new Set(["calendar", "knowledge", "writing"]),
  keep: new Set(["focus", "journal", "archive"]),
  discard: new Set(["archive"]),
};

interface WantSnapshot {
  content: string;
  status: "active";
}

export interface WantRouteInput {
  wantId: number;
  intent: RouteIntent;
  destination: RouteDestination;
  title: string;
  detail: string | null;
  cadence: HabitCadence | null;
  calendar: CalendarSchedule | null;
  idempotencyKey: string;
  original: WantSnapshot;
}

export type ValidationResult =
  | { ok: true; value: WantRouteInput }
  | { ok: false; status: number; error: string };

export interface RouteRow {
  id?: unknown;
  want_id?: unknown;
  intent?: unknown;
  destination?: unknown;
  status?: unknown;
  title?: unknown;
  detail?: unknown;
  cadence?: unknown;
  target_id?: unknown;
  target_url?: unknown;
  error_code?: unknown;
  destination_data?: unknown;
  idempotency_key?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface StoredRoute {
  id: number;
  wantId: number;
  intent: RouteIntent;
  destination: RouteDestination;
  status: "planned" | "created" | "failed" | "cancelled";
  title: string;
  detail: string | null;
  cadence: HabitCadence | null;
  targetId: string | null;
  targetUrl: string | null;
  errorCode: string | null;
  calendar: CalendarSchedule | null;
  idempotencyKey: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SupabaseConnection {
  url: URL;
  key: string;
}

export interface StoredWant {
  id: number;
  content: string;
  status: string;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function normalizeRoute(row: RouteRow): StoredRoute {
  const id = Number(row.id);
  const wantId = Number(row.want_id);
  const intent = typeof row.intent === "string" && intentSet.has(row.intent) ? row.intent as RouteIntent : null;
  const destination = typeof row.destination === "string" && destinationSet.has(row.destination)
    ? row.destination as RouteDestination
    : null;
  const status = typeof row.status === "string" && ["planned", "created", "failed", "cancelled"].includes(row.status)
    ? row.status as StoredRoute["status"]
    : null;
  const cadence = typeof row.cadence === "string" && cadenceSet.has(row.cadence)
    ? row.cadence as HabitCadence
    : null;
  const destinationData = isPlainObject(row.destination_data) ? row.destination_data : {};
  const calendar = parseCalendarSchedule(destinationData.calendar);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(wantId) || wantId <= 0 || !intent || !destination || !status) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  }
  if (typeof row.title !== "string" || typeof row.idempotency_key !== "string") {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "want_routes returned invalid data.");
  }
  return {
    id,
    wantId,
    intent,
    destination,
    status,
    title: row.title,
    detail: stringOrNull(row.detail),
    cadence,
    targetId: stringOrNull(row.target_id),
    targetUrl: stringOrNull(row.target_url),
    errorCode: stringOrNull(row.error_code),
    calendar,
    idempotencyKey: row.idempotency_key,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}
