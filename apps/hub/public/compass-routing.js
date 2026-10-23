const VALID_VIEWS = new Set(["inbox", "wants", "todos"]);

function asUrl(value) {
  return value instanceof URL ? new URL(value.toString()) : new URL(value, "https://compass.invalid");
}

export function parseCompassRoute(value) {
  const url = asUrl(value);
  const requestedView = url.searchParams.get("view");
  const view = VALID_VIEWS.has(requestedView) ? requestedView : "inbox";
  const rawId = url.searchParams.get("id");
  const rawFilter = url.searchParams.get("filter");
  const rawHistory = url.searchParams.get("history");
  const history = rawHistory === "1" && ["inbox", "todos"].includes(requestedView) && rawId !== null;
  if (rawHistory !== null && !history) return { view, id: null, filter: null, error: "invalid-target" };
  const untriaged = rawFilter === "untriaged" && requestedView === "wants" && rawId === null;
  const pendingDestination = (rawFilter === "knowledge" || rawFilter === "github")
    && requestedView === "wants"
    && rawId === null;
  const todoTiming = ["overdue", "today", "upcoming"].includes(rawFilter) && requestedView === "todos" && rawId === null;
  const filter = untriaged ? "untriaged" : pendingDestination ? rawFilter : todoTiming ? rawFilter : null;
  if (rawFilter !== null && filter === null) return { view, id: null, filter: null, error: "invalid-target" };
  if (rawId === null) return { view, id: null, filter, error: null };
  if (!VALID_VIEWS.has(requestedView) || !/^[1-9]\d*$/.test(rawId)) {
    return { view, id: null, filter: null, error: "invalid-target" };
  }
  const id = Number(rawId);
  return Number.isSafeInteger(id)
    ? { view, id, filter: null, error: null, ...(history ? { history: true } : {}) }
    : { view, id: null, filter: null, error: "invalid-target" };
}

/**
 * @param {string | URL} value
 * @param {"inbox" | "wants" | "todos"} view
 * @param {number | null} [id]
 * @param {"untriaged" | "knowledge" | "github" | "overdue" | "today" | "upcoming" | null} [filter]
 * @param {boolean} [history] Explicit completed-record reference, limited to Inbox/ToDo details.
 */
export function compassRoutePath(value, view, id = null, filter = null, history = false) {
  const url = asUrl(value);
  const hasId = id !== null && Number.isSafeInteger(id) && id > 0;
  // 詳細のURLはviewが無いと開けない（parseCompassRoute）ので、Inboxでもidがあればviewを付ける。
  if (view === "wants" || view === "todos" || hasId) url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  if (hasId) url.searchParams.set("id", String(id));
  else url.searchParams.delete("id");
  if (history && hasId && ["inbox", "todos"].includes(view)) url.searchParams.set("history", "1");
  else url.searchParams.delete("history");
  if (id === null && view === "wants" && filter === "untriaged") url.searchParams.set("filter", "untriaged");
  else if (id === null && view === "wants" && (filter === "knowledge" || filter === "github")) url.searchParams.set("filter", filter);
  else if (id === null && view === "todos" && ["overdue", "today", "upcoming"].includes(filter)) url.searchParams.set("filter", filter);
  else url.searchParams.delete("filter");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** New cross-record references may still open a completed original record. */
export function compassHistoryPath(view, id) {
  if (!["inbox", "todos"].includes(view) || !Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid history reference.");
  return compassRoutePath("/compass/", view, id, null, true);
}

/** Preserve the old stale-link fallback; opting in does not open archives/Wants. */
export function compassRouteAllowsClosed(route, status) {
  if (route.history !== true || route.error || route.id === null) return false;
  if (route.view === "todos") return ["completed", "skipped"].includes(status);
  return route.view === "inbox" && ["done", "skipped", "completed", "closed", "cancelled"].includes(status);
}
