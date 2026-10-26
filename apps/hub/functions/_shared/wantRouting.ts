/** Coordinate idempotent target creation and complete the source only after verified success. */
import { type SupabaseConnection, type StoredRoute, type WantRouteInput, isPlainObject } from "./wantRouteModel.ts";
import { WANT_ROUTE_ADAPTERS } from "./wantRouteAdapters.ts";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  restEndpoint,
  supabaseFetch,
  responseError,
  connection,
  findRoute,
  readWant,
  insertRoute,
  completeWant,
  updateRoute,
} from "./wantRouteStore.ts";
import { assertGoogleCalendarConnected, createGoogleCalendarEvent } from "./googleCalendar.ts";

async function createInternalTarget(
  connectionInfo: SupabaseConnection,
  route: StoredRoute,
  input: WantRouteInput,
): Promise<{ targetId: string; targetUrl: string | null }> {
  const adapter = WANT_ROUTE_ADAPTERS[input.destination];
  if (!adapter) throw new DashboardError("WANT_ROUTE_INVALID", "Destination adapter is missing.", 400);
  if (adapter.mode === "archive") return { targetId: `want:${input.wantId}`, targetUrl: null };
  if (adapter.mode !== "internal") {
    throw new DashboardError("WANT_ROUTE_INVALID", "Destination does not have an internal adapter.", 400);
  }
  const endpoint = restEndpoint(connectionInfo, adapter.table);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("on_conflict", "source_route_id");
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(adapter.payload({
      routeId: route.id,
      wantId: input.wantId,
      title: input.title,
      detail: input.detail,
      cadence: input.cadence,
    })),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw responseError(response, adapter.table);
    if (adapter.table === "focus_items") {
      const detail = await response.text().catch(() => "");
      if (detail.includes("FOCUS_ACTIVE_LIMIT")) {
        throw new DashboardError("FOCUS_LIMIT_REACHED", "The active Focus board is full.", 409);
      }
    }
    throw new DashboardError("WANT_ROUTE_FAILED", `${adapter.table} returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !isPlainObject(rows[0]) || !Number.isSafeInteger(Number(rows[0].id))) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${adapter.table} returned invalid data.`);
  }
  const targetId = String(rows[0].id);
  return {
    targetId,
    targetUrl: adapter.table === "writing_topics" ? `/writing/?id=${encodeURIComponent(targetId)}` : null,
  };
}

export async function routeWant(env: DashboardEnv, input: WantRouteInput): Promise<StoredRoute> {
  const connectionInfo = connection(env);
  const adapter = WANT_ROUTE_ADAPTERS[input.destination];
  if (!adapter) throw new DashboardError("WANT_ROUTE_INVALID", "Destination adapter is missing.", 400);

  const existing = await findRoute(connectionInfo, input.idempotencyKey);
  if (existing) {
    if (existing.wantId !== input.wantId || existing.intent !== input.intent || existing.destination !== input.destination ||
        existing.title !== input.title || existing.detail !== input.detail || existing.cadence !== input.cadence ||
        JSON.stringify(existing.calendar) !== JSON.stringify(input.calendar)) {
      throw new DashboardError("WANT_ROUTE_CONFLICT", "Idempotency key belongs to another route.", 409);
    }
  }

  const want = await readWant(connectionInfo, input);
  if (want.status === "completed") {
    if (existing && (existing.status === "created" || (adapter.mode === "planned" && existing.status === "planned"))) {
      return existing;
    }
    throw new DashboardError("WANT_UPDATE_CONFLICT", "Completed Want does not match a finished route.", 409);
  }
  if (want.status !== "active") {
    throw new DashboardError("WANT_UPDATE_CONFLICT", "Want changed before routing.", 409);
  }

  let route: StoredRoute;
  if (existing) {
    route = existing;
  } else {
    if (adapter.mode === "external" && adapter.provider === "google_calendar") {
      await assertGoogleCalendarConnected(env);
    }
    route = await insertRoute(connectionInfo, input);
  }

  if (adapter.mode === "planned") {
    await completeWant(connectionInfo, input, want);
    return route;
  }
  if (route.status === "created") {
    await completeWant(connectionInfo, input, want);
    return route;
  }
  if (route.status === "cancelled") throw new DashboardError("WANT_ROUTE_CONFLICT", "Cancelled route cannot be retried.", 409);
  if (adapter.mode === "external" && adapter.provider === "google_calendar") {
    await assertGoogleCalendarConnected(env);
  }
  if (route.status === "failed") {
    route = await updateRoute(connectionInfo, route, { status: "planned", error_code: null });
  }

  try {
    const target = adapter.mode === "external" && adapter.provider === "google_calendar"
      ? await createGoogleCalendarEvent(env, {
          wantId: input.wantId,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          detail: input.detail,
          schedule: input.calendar!,
        })
      : await createInternalTarget(connectionInfo, route, input);
    route = await updateRoute(connectionInfo, route, {
      status: "created",
      target_id: target.targetId,
      target_url: target.targetUrl,
      error_code: null,
    });
  } catch (error) {
    const failure = error instanceof DashboardError ? error : new DashboardError("WANT_ROUTE_FAILED", "Route failed.");
    try {
      await updateRoute(connectionInfo, route, { status: "failed", error_code: failure.code });
    } catch {
      // The source Want remains active even if recording the failure also fails.
    }
    throw failure;
  }

  await completeWant(connectionInfo, input, want);
  return route;
}

export {
  ROUTE_DESTINATIONS,
  ROUTE_INTENTS,
  HABIT_CADENCES,
  type WantRouteInput,
  type RouteRow,
  type StoredRoute,
  type SupabaseConnection,
  isPlainObject,
  normalizeRoute,
} from "./wantRouteModel.ts";

export { validateWantRouteRequest, readWantRouteInput } from "./wantRouteValidation.ts";

export { connection, restEndpoint, supabaseFetch, responseError, routeSelect } from "./wantRouteStore.ts";
