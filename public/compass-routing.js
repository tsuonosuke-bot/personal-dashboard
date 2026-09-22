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
  const untriaged = rawFilter === "untriaged" && requestedView === "wants" && rawId === null;
  const knowledge = rawFilter === "knowledge" && (requestedView === null || requestedView === "inbox" || requestedView === "wants") && rawId === null;
  const todoTiming = ["overdue", "today", "upcoming"].includes(rawFilter) && requestedView === "todos" && rawId === null;
  const filter = untriaged ? "untriaged" : knowledge ? "knowledge" : todoTiming ? rawFilter : null;
  if (rawFilter !== null && filter === null) return { view, id: null, filter: null, error: "invalid-target" };
  if (rawId === null) return { view, id: null, filter, error: null };
  if (!VALID_VIEWS.has(requestedView) || !/^[1-9]\d*$/.test(rawId)) {
    return { view, id: null, filter: null, error: "invalid-target" };
  }
  const id = Number(rawId);
  return Number.isSafeInteger(id)
    ? { view, id, filter: null, error: null }
    : { view, id: null, filter: null, error: "invalid-target" };
}

/**
 * @param {string | URL} value
 * @param {"inbox" | "wants" | "todos"} view
 * @param {number | null} [id]
 * @param {"untriaged" | "knowledge" | "overdue" | "today" | "upcoming" | null} [filter]
 */
export function compassRoutePath(value, view, id = null, filter = null) {
  const url = asUrl(value);
  if (view === "wants" || view === "todos") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  if (id !== null && Number.isSafeInteger(id) && id > 0) url.searchParams.set("id", String(id));
  else url.searchParams.delete("id");
  if (id === null && view === "wants" && filter === "untriaged") url.searchParams.set("filter", "untriaged");
  else if (id === null && filter === "knowledge" && view !== "todos") url.searchParams.set("filter", "knowledge");
  else if (id === null && view === "todos" && ["overdue", "today", "upcoming"].includes(filter)) url.searchParams.set("filter", filter);
  else url.searchParams.delete("filter");
  return `${url.pathname}${url.search}${url.hash}`;
}
