const VALID_VIEWS = new Set(["inbox", "wants"]);

function asUrl(value) {
  return value instanceof URL ? new URL(value.toString()) : new URL(value, "https://compass.invalid");
}

export function parseCompassRoute(value) {
  const url = asUrl(value);
  const requestedView = url.searchParams.get("view");
  const view = VALID_VIEWS.has(requestedView) ? requestedView : "inbox";
  const rawId = url.searchParams.get("id");
  const rawFilter = url.searchParams.get("filter");
  const filter = rawFilter === "untriaged" && requestedView === "wants" && rawId === null ? "untriaged" : null;
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

export function compassRoutePath(value, view, id = null, filter = null) {
  const url = asUrl(value);
  if (view === "wants") url.searchParams.set("view", "wants");
  else url.searchParams.delete("view");
  if (id !== null && Number.isSafeInteger(id) && id > 0) url.searchParams.set("id", String(id));
  else url.searchParams.delete("id");
  if (id === null && view === "wants" && filter === "untriaged") url.searchParams.set("filter", "untriaged");
  else url.searchParams.delete("filter");
  return `${url.pathname}${url.search}${url.hash}`;
}
