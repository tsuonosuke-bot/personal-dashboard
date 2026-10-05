// 一覧・タブ・まとめ・件数、ビューの切り替えとURLとの同期。
import { compassRoutePath, parseCompassRoute } from "../compass-routing.js";
import { clearBulkSelection, renderBulkControls } from "./bulk.js";
import { closedStatusesByView, defaultStatusByView, routeDestinationMeta, viewMeta } from "./constants.js";
import { loadTodos } from "./data.js";
import { hideDrawer, openDrawer } from "./drawer.js";
import { escapeHtml, formatCalendarSchedule, formatDate, showToast, sortTodos, todayInTokyo, todoTiming, todoTimingLabel } from "./format.js";
import { els, state } from "./state.js";

export function currentItems() {
  if (!state.data) return [];
  let items = state.data[state.view] || [];
  if (state.status) items = items.filter((item) => item.status === state.status);
  if (state.view === "wants" && state.metricFilter === "untriaged") {
    items = items.filter((item) => item.status === "active"
      && item.type !== "wish"
      && (!item.revisitOn || item.revisitOn <= todayInTokyo()));
  }
  if (state.metricFilter === "knowledge" || state.metricFilter === "github") {
    items = items.filter((item) => isDestinationPending(item, state.view, state.metricFilter));
  }
  if (state.view === "todos" && ["overdue", "today", "upcoming"].includes(state.metricFilter)) {
    items = items.filter((item) => item.status === "pending" && todoTiming(item) === state.metricFilter);
  }
  const needle = state.search.trim().toLocaleLowerCase("ja");
  if (needle) {
    items = items.filter((item) => [item.content, item.title, item.detail, item.result, item.note]
      .filter(Boolean).some((value) => value.toLocaleLowerCase("ja").includes(needle)));
  }
  return state.view === "todos" ? sortTodos(items) : items;
}

export function updateStatusOptions() {
  const items = state.data?.[state.view] || [];
  const statuses = [...new Set(items.map((item) => item.status))].sort();
  els.statusFilter.innerHTML = '<option value="">すべてのステータス</option>'
    + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</option>`).join("");
  els.statusFilter.value = state.status;
}

export function renderSummary() {
  const { summary } = state.data;
  els.knowledgePendingCount.textContent = summary.knowledgePending ?? 0;
  els.githubPendingCount.textContent = summary.githubPending ?? 0;
}

function renderCurrentTabCount(items) {
  els.inboxTabCount.textContent = state.data.inbox.filter((item) => item.status === defaultStatusByView.inbox).length;
  els.wantsTabCount.textContent = state.data.wants.filter((item) => item.status === defaultStatusByView.wants).length;
  els.todosTabCount.textContent = state.data.todosSummary?.pending ?? "—";
  const countElement = {
    inbox: els.inboxTabCount,
    wants: els.wantsTabCount,
    todos: els.todosTabCount,
  }[state.view];
  countElement.textContent = items.length;
}

export function renderNavigation(items) {
  els.dashboardNav.innerHTML = items.map((item) => {
    const label = escapeHtml(item.label);
    if (item.current) return `<span class="current">${label}<small>CURRENT</small></span>`;
    if (!item.url) return `<span class="unavailable">${label}<small>SOON</small></span>`;
    return `<a href="${escapeHtml(item.url)}">${label}<small>OPEN</small></a>`;
  }).join("");
}

export function statusLabel(status, view = state.view) {
  if (view === "todos") return ({ pending: "未実施", completed: "完了", skipped: "見送り" })[status] || status;
  return ({ pending: "未整理", done: "整理済み", skipped: "対象外", active: "未整理", completed: "整理済み", dropped: "見送り", closed: "完了" })[status] || status;
}

export function itemStatusLabel(item, view = state.view) {
  if (view === "wants" && item.status === "active" && item.type === "wish") return "欲しいもの";
  if (view === "wants" && item.status === "active" && item.revisitOn && item.revisitOn > todayInTokyo()) return "寝かせ中";
  return statusLabel(item.status);
}

export function canCloseItem(item, view) {
  return !closedStatusesByView[view]?.has(item.status);
}

function triageEntries(item, view) {
  if (view === "inbox") {
    const triage = item.triage || { destinations: [], revisitOn: null };
    return { destinations: triage.destinations || [], revisitOn: triage.revisitOn || null };
  }
  const destinations = new Map();
  (item.routes || []).forEach((route) => {
    if (route.status !== "planned" && route.status !== "created") return;
    if (destinations.get(route.destination) !== "created") destinations.set(route.destination, route.status);
  });
  return {
    destinations: [...destinations].map(([destination, status]) => ({ destination, status })),
    wish: item.status === "active" && item.type === "wish",
    revisitOn: item.status === "active" ? item.revisitOn || null : null,
  };
}

function isDestinationPending(item, view, destination) {
  return triageEntries(item, view).destinations
    .some((entry) => entry.destination === destination && entry.status === "planned");
}

function triageChips(item, view) {
  const { destinations, wish, revisitOn } = triageEntries(item, view);
  const chips = destinations.map((entry) => {
    const label = routeDestinationMeta[entry.destination]?.label || entry.destination;
    if (entry.destination === "knowledge" && entry.status === "planned") {
      return '<span class="route-chip route-chip-pending">Knowledge登録待ち</span>';
    }
    if (entry.destination === "github" && entry.status === "planned") {
      return '<span class="route-chip route-chip-pending">GitHub登録待ち</span>';
    }
    const pending = entry.status === "planned" ? "登録待ち" : "";
    return `<span class="route-chip">${escapeHtml(label)}${pending ? ` · ${pending}` : ""}</span>`;
  });
  if (wish) chips.push('<span class="route-chip route-chip-wish">欲しい</span>');
  if (revisitOn) chips.push(`<span class="route-chip route-chip-revisit">再訪 ${escapeHtml(formatDate(revisitOn))}</span>`);
  if (chips.length > 0) return chips.join("");
  if (view === "wants" && item.status === "active") return '<span class="route-chip route-chip-quiet">未振り分け</span>';
  return "";
}

function cardMarkup(item) {
  if (state.view === "todos") {
    const timing = item.status === "pending" ? todoTimingLabel(item) : statusLabel(item.status, "todos");
    const timingClass = item.status === "pending" ? `todo-timing-${todoTiming(item)}` : `status-${item.status}`;
    return `<button class="item-card todo-card" type="button" data-id="${item.id}">
      <div class="item-top"><span class="item-id">TODO · ${item.id}</span><span class="status ${escapeHtml(timingClass)}">${escapeHtml(timing)}</span></div>
      <h3>${escapeHtml(item.title || "内容なし")}</h3>
      <div class="todo-schedule">${escapeHtml(formatCalendarSchedule(item.schedule))}</div>
      <div class="item-footer"><span>Want · ${item.sourceWantId}</span><span>${item.rescheduleCount ? `日程変更 ${item.rescheduleCount}回` : "Calendar登録済み"}</span></div>
    </button>`;
  }
  if (state.view === "inbox" && state.bulkMode) {
    const checked = state.bulkSelected.has(item.id);
    return `<label class="item-card bulk-item-card${checked ? " selected" : ""}" data-id="${item.id}">
      <input class="bulk-item-checkbox" type="checkbox" value="${item.id}" ${checked ? "checked" : ""} aria-label="Inbox ${item.id}を選択">
      <div class="bulk-item-content">
        <div class="item-top"><span class="item-id">INBOX · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(itemStatusLabel(item))}</span></div>
        <h3>${escapeHtml(item.content || "内容なし")}</h3>
        <div class="item-footer"><span>${formatDate(item.createdAt)}</span><span class="route-chips">${triageChips(item, "inbox")}</span></div>
      </div>
    </label>`;
  }
  return `<button class="item-card" type="button" data-id="${item.id}">
    <div class="item-top"><span class="item-id">${viewMeta[state.view].singular.toUpperCase()} · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(itemStatusLabel(item))}</span></div>
    <h3>${escapeHtml(item.content || "内容なし")}</h3>
    <div class="item-footer"><span>${formatDate(item.createdAt)}</span><span class="route-chips">${triageChips(item, state.view)}</span></div>
  </button>`;
}

export function renderList() {
  const items = currentItems();
  renderCurrentTabCount(items);
  els.listTitle.textContent = viewMeta[state.view].title;
  els.resultCount.textContent = `${items.length}件を表示`;
  els.clearFilter.hidden = !(state.status || state.search || state.metricFilter);
  const knowledgeActive = state.metricFilter === "knowledge";
  const githubActive = state.metricFilter === "github";
  els.pendingFilterGroup.hidden = state.view === "todos";
  els.todoFilterGroup.hidden = state.view !== "todos";
  els.knowledgeFilter.classList.toggle("active", knowledgeActive);
  els.knowledgeFilter.setAttribute("aria-pressed", String(knowledgeActive));
  els.githubFilter.classList.toggle("active", githubActive);
  els.githubFilter.setAttribute("aria-pressed", String(githubActive));
  els.todoFilterGroup.querySelectorAll("[data-todo-filter]").forEach((button) => {
    const active = state.metricFilter === button.dataset.todoFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderBulkControls(items);
  if (!items.length) {
    const description = state.view === "todos" && !state.todosLoaded
      ? "Google CalendarとToDoを同期しています。"
      : "検索条件やステータスを変えて確認できます。";
    els.cardList.innerHTML = `<div class="empty-state"><span>◇</span><h3>${escapeHtml(viewMeta[state.view].empty)}</h3><p>${escapeHtml(description)}</p></div>`;
    return;
  }
  els.cardList.innerHTML = items.map(cardMarkup).join("");
  if (state.view === "inbox" && state.bulkMode) {
    els.cardList.querySelectorAll(".bulk-item-checkbox").forEach((checkbox) => checkbox.addEventListener("change", () => {
      const id = Number(checkbox.value);
      if (checkbox.checked) state.bulkSelected.add(id);
      else state.bulkSelected.delete(id);
      state.bulkError = "";
      renderList();
    }));
  } else {
    els.cardList.querySelectorAll(".item-card").forEach((card) => card.addEventListener("click", () => openDrawer(Number(card.dataset.id))));
  }
}

export function syncCompassRoute(view, id = null, mode = "replace", filter = null) {
  const path = compassRoutePath(window.location.href, view, id, filter);
  const historyState = id === null ? null : { compassDrawer: true };
  if (mode === "push") window.history.pushState(historyState, "", path);
  else window.history.replaceState(historyState, "", path);
}

export function setView(view, filter = defaultStatusByView[view], sync = true) {
  hideDrawer();
  state.bulkMode = false;
  state.bulkSubmitting = false;
  clearBulkSelection();
  state.view = view;
  state.metricFilter = filter;
  state.status = filter === "untriaged"
    ? "active"
    : filter === "knowledge" || filter === "github"
      ? ""
      : view === "todos" && ["overdue", "today", "upcoming"].includes(filter)
        ? "pending"
        : filter || "";
  updateStatusOptions();
  renderList();
  if (view === "todos" && !state.todosLoaded) void loadTodos(true);
  const routeFilter = ["untriaged", "knowledge", "github", "overdue", "today", "upcoming"].includes(filter) ? filter : null;
  if (sync) syncCompassRoute(view, null, "push", routeFilter);
}

export function applyCompassRoute(notify = true) {
  if (!state.data) return;
  const route = parseCompassRoute(window.location.href);
  state.bulkMode = false;
  state.bulkSubmitting = false;
  clearBulkSelection();
  state.view = route.view;
  state.status = route.filter === "knowledge" || route.filter === "github"
    ? ""
    : route.view === "todos" && ["overdue", "today", "upcoming"].includes(route.filter)
      ? "pending"
      : defaultStatusByView[route.view];
  state.metricFilter = route.filter || "";
  state.search = "";
  els.searchInput.value = "";
  hideDrawer();

  if (route.error) {
    updateStatusOptions();
    renderList();
    syncCompassRoute(route.view);
    if (notify) showToast("指定された対象を開けません。一覧を表示します。");
    return;
  }

  if (route.id !== null) {
    const item = (state.data[route.view] || []).find((entry) => entry.id === route.id);
    if (!item) {
      state.status = "";
      updateStatusOptions();
      renderList();
      syncCompassRoute(route.view);
      if (notify) showToast(`対象の${viewMeta[route.view].singular}が見つかりません。一覧を表示します。`);
      return;
    }
    if (closedStatusesByView[route.view]?.has(item.status)) {
      state.status = "";
      updateStatusOptions();
      renderList();
      syncCompassRoute(route.view);
      if (notify) showToast(`対象の${viewMeta[route.view].singular}は完了またはアーカイブ済みです。一覧を表示します。`);
      return;
    }
  }

  updateStatusOptions();
  renderList();
  if (route.id !== null) openDrawer(route.id, route.view, "none");
}
