// ダッシュボードとToDoの読み込み。
import { readApiJson } from "../api-client.js";
import { parseCompassRoute } from "../compass-routing.js";
import { escapeHtml, setSource } from "./format.js";
import { applyCompassRoute, renderList, renderSummary, updateStatusOptions } from "./list.js";
import { els, state } from "./state.js";
import { defaultStatusByView } from "./constants.js";

let todoLoadGeneration = 0;
let dashboardLoadGeneration = 0;

export function ideaParams({ offset = 0, id = null, routeOffset = 0 } = {}) {
  const view = state.view === "todos" ? "summary" : state.view;
  const params = new URLSearchParams({ view, status: state.status, q: state.search, filter: ["knowledge", "github", "untriaged"].includes(state.metricFilter) ? state.metricFilter : "", category: state.wantCategory, offset: String(offset) });
  if (id !== null) params.set("id", String(id));
  if (routeOffset) params.set("routeOffset", String(routeOffset));
  return params;
}

async function ideaPage(params) {
  const response = await fetch(`/api/dashboard?${params}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(payload.error?.message || payload.error || "データを読み込めませんでした。");
  return payload;
}

export async function loadNextPendingInbox() {
  const params = new URLSearchParams({ view: "inbox", status: "pending", q: "", filter: "", category: "", limit: "1" });
  const payload = await ideaPage(params);
  const item = payload.inbox?.[0];
  if (item) state.data.inbox = [...state.data.inbox.filter((entry) => entry.id !== item.id), item];
  state.data.summary = payload.summary;
  return item || null;
}

/** Explicit all-result actions may traverse pages; opening a tab never does. */
export async function loadAllIdeaItems() {
  if (state.view === "todos") return;
  const generation = dashboardLoadGeneration;
  let page = state.pages?.[state.view];
  while (page?.hasMore) {
    const payload = await ideaPage(ideaParams({ offset: page.offset + 50 }));
    if (generation !== dashboardLoadGeneration) throw new Error("表示条件が変わりました。もう一度選択してください。");
    const field = state.view;
    state.data[field] = [...new Map([...state.data[field], ...payload[field]].map((item) => [item.id, item])).values()];
    state.pages[field] = page = payload.page;
  }
  renderList();
}

export async function loadIdeaDetail(id, view = state.view, routeOffset = 0) {
  const params = ideaParams({ id, routeOffset });
  params.set("view", view);
  const payload = await ideaPage(params);
  const item = payload[view]?.[0];
  if (!item) throw new Error("対象が見つかりません。");
  const previous = state.data[view].find((entry) => entry.id === id);
  if (routeOffset && previous) item.routes = [...new Map([...(previous.routes || []), ...(item.routes || [])].map((route) => [route.id, route])).values()];
  if (state.data[view].some((entry) => entry.id === id)) state.data[view] = state.data[view].map((entry) => entry.id === id ? item : entry);
  else state.data[view].push(item);
  return item;
}

/** A successful save is authoritative even if a later list refresh is offline. */
export function applySavedIdeaRow(view, row, previous) {
  dashboardLoadGeneration++;
  els.refreshButton.disabled = false;
  const item = { ...previous, id: Number(row.id), content: row.content, status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : previous.createdAt,
    ...(view === "inbox" ? { result: row.result ?? null } : { category: row.category ?? null }) };
  state.data[view] = state.data[view].map((entry) => entry.id === item.id ? item : entry);
  const summary = state.data.summary;
  if (view === "inbox") summary.pendingInbox += Number(item.status === "pending") - Number(previous.status === "pending");
  else {
    summary.activeWants += Number(item.status === "active") - Number(previous.status === "active");
    summary.completedWants += Number(item.status === "completed") - Number(previous.status === "completed");
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const due = (want) => want.status === "active" && want.revisitOn && want.revisitOn <= today;
    summary.dueForReview += Number(Boolean(due(item))) - Number(Boolean(due(previous)));
    summary.untriagedWants += Number(Boolean(due(item)) && item.type !== "wish") - Number(Boolean(due(previous)) && previous.type !== "wish");
  }
  const page = state.pages?.[view];
  const matches = (entry, includeCategory) => {
    if (state.status && entry.status !== state.status) return false;
    const needle = state.search.trim().toLocaleLowerCase("ja");
    if (needle && ![entry.content, entry.note, entry.result].filter(Boolean).some((value) => value.toLocaleLowerCase("ja").includes(needle))) return false;
    if (["knowledge", "github"].includes(state.metricFilter)) {
      const routes = entry.routes || [];
      if (!routes.some((route) => route.destination === state.metricFilter && route.status === "planned")
        || routes.some((route) => route.destination === state.metricFilter && route.status === "created")) return false;
    }
    if (state.metricFilter === "untriaged" && !(entry.status === "active" && entry.type !== "wish" && entry.revisitOn
      && entry.revisitOn <= new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10))) return false;
    if (includeCategory && state.wantCategory && (entry.category || (entry.type === "wish" ? "wish" : "other")) !== state.wantCategory) return false;
    return true;
  };
  if (page) page.total = Math.max(0, page.total + Number(matches(item, true)) - Number(matches(previous, true)));
  if (page?.categoryCounts) {
    const oldCategory = previous.category || (previous.type === "wish" ? "wish" : "other");
    const newCategory = item.category || (item.type === "wish" ? "wish" : "other");
    page.categoryCounts[oldCategory] = Math.max(0, (page.categoryCounts[oldCategory] || 0) - Number(matches(previous, false)));
    page.categoryCounts[newCategory] = (page.categoryCounts[newCategory] || 0) + Number(matches(item, false));
  }
  renderSummary();
  renderList();
  return item;
}

export async function loadTodos(render = state.view === "todos", options = {}) {
  if (!state.data) return false;
  const generation = ++todoLoadGeneration;
  if (render) els.cardList.innerHTML = '<div class="loading"><span></span><p>Google CalendarとToDoを同期しています</p></div>';
  try {
    const history = state.status !== "pending";
    const scope = history ? "history" : "current";
    let offset = options.append ? state.todoPage?.nextOffset || 0 : 0;
    let payload;
    let items = options.append ? [...state.data.todos] : [];
    if (history && state.status === "" && !options.append) {
      const response = await fetch("/api/scheduled-actions?scope=current", { headers: { Accept: "application/json" }, cache: "no-store" });
      const current = await readApiJson(response);
      if (!response.ok) throw new Error(current.error?.message || "ToDoを読み込めませんでした。");
      items.push(...current.items);
    }
    do {
      const response = await fetch(`/api/scheduled-actions?scope=${scope}&offset=${offset}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      payload = await readApiJson(response);
      if (generation !== todoLoadGeneration) return false;
      if (!response.ok) throw new Error(payload.error?.message || payload.error || "ToDoを読み込めませんでした。");
      items.push(...(payload.items || []));
      offset = payload.page?.nextOffset;
    } while (history && state.search && payload.page?.hasMore);
    const route = parseCompassRoute(window.location.href);
    if (route.view === "todos" && route.id !== null && !items.some((item) => item.id === route.id)) {
      const response = await fetch(`/api/scheduled-actions?ids=${route.id}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const direct = await readApiJson(response);
      if (!response.ok) throw new Error(direct.error?.message || "ToDoを読み込めませんでした。");
      items.push(...direct.items);
    }
    if (generation !== todoLoadGeneration) return false;
    state.data.todos = [...new Map(items.map((item) => [item.id, item])).values()];
    state.todoPage = payload.page;
    state.data.todosSummary = payload.summary || { pending: 0, completed: 0, skipped: 0 };
    state.todoSource = payload.source || null;
    state.todosLoaded = true;
    renderSummary();
    els.todosTabCount.textContent = state.data.todosSummary.pending;
    if (state.view === "todos") {
      updateStatusOptions();
      renderList();
    }
    return true;
  } catch (error) {
    if (generation !== todoLoadGeneration) return false;
    state.todosLoaded = false;
    els.todosTabCount.textContent = "—";
    if (render && state.view === "todos") {
      els.resultCount.textContent = "ToDoの読み込みに失敗しました";
      els.cardList.innerHTML = `<div class="error-state"><h3>ToDoを表示できません</h3><p>${escapeHtml(error instanceof Error ? error.message : "ToDoを読み込めませんでした。")}</p><button type="button" id="retryTodosButton">再試行</button></div>`;
      document.getElementById("retryTodosButton").addEventListener("click", () => loadTodos(true));
    }
    return false;
  }
}

export async function loadDashboard(options = {}) {
  const generation = ++dashboardLoadGeneration;
  const initial = !state.data;
  const route = parseCompassRoute(window.location.href);
  if (initial || options.route) {
    state.view = route.view;
    state.metricFilter = route.filter || "";
    state.status = ["knowledge", "github"].includes(route.filter) ? "" : defaultStatusByView[route.view];
    state.search = "";
    state.wantCategory = "";
    els.searchInput.value = "";
  }
  els.refreshButton.disabled = true;
  els.cardList.innerHTML = '<div class="loading"><span></span><p>Supabaseから読み込んでいます</p></div>';
  try {
    const view = state.view;
    const params = ideaParams({ offset: options.append ? (state.pages?.[view]?.offset || 0) + 50 : 0 });
    const payload = await ideaPage(params);
    if (generation !== dashboardLoadGeneration) return false;
    for (const field of ["inbox", "wants"]) {
      if (field !== view) payload[field] = state.data?.[field] || [];
      else if (options.append) payload[field] = [...new Map([...(state.data?.[field] || []), ...payload[field]].map((item) => [item.id, item])).values()];
    }
    payload.todos = state.data?.todos || [];
    payload.todosSummary = state.data?.todosSummary || null;
    state.data = payload;
    state.pages ||= {};
    state.pages[view] = payload.page;
    setSource(payload.source);
    renderSummary();
    if (view === "todos") await loadTodos(false);
    if ((initial || options.route) && route.id !== null && view !== "todos"
      && !state.data[view].some((item) => item.id === route.id)) await loadIdeaDetail(route.id, view);
    if (initial || options.route) applyCompassRoute();
    else { updateStatusOptions(); renderList(); }
    return true;
  } catch (error) {
    if (generation !== dashboardLoadGeneration) return false;
    setSource(null, true);
    els.resultCount.textContent = "読み込みに失敗しました";
    els.cardList.innerHTML = `<div class="error-state"><h3>データを表示できません</h3><p>${escapeHtml(error.message)}</p><button type="button" id="retryButton">再試行</button></div>`;
    document.getElementById("retryButton").addEventListener("click", loadDashboard);
    return false;
  } finally {
    if (generation === dashboardLoadGeneration) els.refreshButton.disabled = false;
  }
}
