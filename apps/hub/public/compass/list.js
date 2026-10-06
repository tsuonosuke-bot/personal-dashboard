// 一覧・タブ・まとめ・件数、ビューの切り替えとURLとの同期。
import { compassRoutePath, parseCompassRoute } from "../compass-routing.js";
import { clearBulkSelection, renderBulkControls } from "./bulk.js";
import { renderTodoCalendar } from "./calendar.js";
import { closedStatusesByView, defaultStatusByView, routeDestinationMeta, viewMeta } from "./constants.js";
import { loadTodos } from "./data.js";
import { hideDrawer, openDrawer } from "./drawer.js";
import { escapeHtml, formatCalendarSchedule, formatDate, showToast, sortTodos, sourceChipMarkup, splitInboxSource, todayInTokyo, todoTiming, todoTimingLabel } from "./format.js";
import { els, state } from "./state.js";
import { WANT_CATEGORIES, groupWantsByCategory, wantBacklogStage, wantCategory, wantCategoryMeta } from "./want-category.js";

// Wantsの既定の見え方。Active Wantsを「やりたいことのバックログ」として分類ごとに並べる。
// 登録待ち（Knowledge・GitHub）や完了・見送りの確認は、従来どおりカードの一覧で出す。
export function isWantsBacklog() {
  return state.view === "wants" && state.status === "active"
    && state.metricFilter !== "knowledge" && state.metricFilter !== "github";
}

export function currentItems({ ignoreCategory = false } = {}) {
  if (!state.data) return [];
  let items = state.data[state.view] || [];
  if (state.status) items = items.filter((item) => item.status === state.status);
  if (state.view === "wants" && state.metricFilter === "untriaged") {
    items = items.filter((item) => item.status === "active"
      && item.type !== "wish"
      && Boolean(item.revisitOn) && item.revisitOn <= todayInTokyo());
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
  if (!ignoreCategory && isWantsBacklog() && state.wantCategory) {
    items = items.filter((item) => wantCategory(item) === state.wantCategory);
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

export function statusLabel(status, view = state.view) {
  if (view === "wants") return ({ active: "バックログ", completed: "完了", dropped: "見送り" })[status] || status;
  if (view === "todos") return ({ pending: "未実施", completed: "完了", skipped: "見送り" })[status] || status;
  return ({ pending: "未整理", done: "整理済み", skipped: "対象外", active: "未整理", completed: "整理済み", dropped: "見送り", closed: "完了" })[status] || status;
}

export function itemStatusLabel(item, view = state.view) {
  if (view === "wants" && item.status === "active" && item.type === "wish") return "欲しいもの";
  if (view === "wants" && item.status === "active" && item.revisitOn && item.revisitOn > todayInTokyo()) return "寝かせ中";
  if (view === "wants" && item.status === "active" && item.revisitOn) return "再訪日が来た";
  return statusLabel(item.status, view);
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
  // 深掘りから登録されたInboxは、出典の行を本文から外して小さなチップにする。
  const { body: text, source } = state.view === "inbox" ? splitInboxSource(item.content) : { body: item.content, source: null };
  const sourceChip = sourceChipMarkup(source, { link: false });
  if (state.view === "inbox" && state.bulkMode) {
    const checked = state.bulkSelected.has(item.id);
    return `<label class="item-card bulk-item-card${checked ? " selected" : ""}" data-id="${item.id}">
      <input class="bulk-item-checkbox" type="checkbox" value="${item.id}" ${checked ? "checked" : ""} aria-label="Inbox ${item.id}を選択">
      <div class="bulk-item-content">
        <div class="item-top"><span class="item-id">INBOX · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(itemStatusLabel(item))}</span></div>
        <h3>${escapeHtml(text || "内容なし")}</h3>
        <div class="item-footer"><span>${formatDate(item.createdAt)}${sourceChip}</span><span class="route-chips">${triageChips(item, "inbox")}</span></div>
      </div>
    </label>`;
  }
  return `<button class="item-card" type="button" data-id="${item.id}">
    <div class="item-top"><span class="item-id">${viewMeta[state.view].singular.toUpperCase()} · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(itemStatusLabel(item))}</span></div>
    <h3>${escapeHtml(text || "内容なし")}</h3>
    <div class="item-footer"><span>${formatDate(item.createdAt)}${sourceChip}</span><span class="route-chips">${triageChips(item, state.view)}</span></div>
  </button>`;
}

function wantRowMarkup(item, today) {
  const stage = wantBacklogStage(item, today);
  const chips = [];
  if (stage === "due") chips.push(`<span class="route-chip route-chip-pending">再訪日 ${escapeHtml(formatDate(item.revisitOn))}</span>`);
  if (stage === "sleeping") chips.push(`<span class="route-chip">寝かせ中 〜${escapeHtml(formatDate(item.revisitOn))}</span>`);
  (item.routes || []).filter((route) => route.status === "planned").forEach((route) => {
    const label = routeDestinationMeta[route.destination]?.label || route.destination;
    chips.push(`<span class="route-chip route-chip-pending">${escapeHtml(label)} · 登録待ち</span>`);
  });
  return `<button class="want-row want-stage-${stage}" type="button" data-id="${item.id}">
    <span class="want-row-title">${escapeHtml(item.content || "内容なし")}</span>
    ${chips.length ? `<span class="want-row-meta">${chips.join("")}</span>` : ""}
  </button>`;
}

function renderWantCategoryBar() {
  const backlog = isWantsBacklog();
  els.wantCategoryBar.hidden = !backlog;
  if (!backlog) return;
  const counts = new Map();
  currentItems({ ignoreCategory: true }).forEach((item) => {
    const key = wantCategory(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const chip = (key, label, count) => {
    const active = state.wantCategory === key;
    return `<button class="filter-chip category-chip${active ? " active" : ""}" type="button" data-want-category="${escapeHtml(key)}" aria-pressed="${active}">${escapeHtml(label)} <b>${count}</b></button>`;
  };
  els.wantCategoryBar.innerHTML = chip("", "すべて", total)
    + WANT_CATEGORIES.filter((category) => counts.has(category.key) || state.wantCategory === category.key)
      .map((category) => chip(category.key, category.label, counts.get(category.key) || 0)).join("");
  els.wantCategoryBar.querySelectorAll("[data-want-category]").forEach((button) => button.addEventListener("click", () => {
    state.wantCategory = state.wantCategory === button.dataset.wantCategory ? "" : button.dataset.wantCategory;
    renderList();
  }));
}

function renderWantsBacklog(items) {
  const today = todayInTokyo();
  const groups = groupWantsByCategory(items, today);
  const sleeping = items.filter((item) => wantBacklogStage(item, today) === "sleeping").length;
  const due = items.filter((item) => wantBacklogStage(item, today) === "due").length;
  const scope = state.wantCategory ? wantCategoryMeta(state.wantCategory).label : "やりたいこと";
  els.resultCount.textContent = `${scope} ${items.length}件`
    + (due ? ` · 再訪日が来た ${due}件` : "")
    + (sleeping ? ` · 寝かせ中 ${sleeping}件` : "");
  els.cardList.classList.add("backlog");
  if (!items.length) {
    els.cardList.innerHTML = `<div class="empty-state"><span>◇</span><h3>該当するやりたいことはありません</h3><p>Inboxで「欲しいもの」や「保留」に振り分けると、ここに積まれます。</p></div>`;
    return;
  }
  els.cardList.innerHTML = groups.map((group) => `<section class="want-group" aria-label="${escapeHtml(group.label)} ${group.items.length}件">
    <header class="want-group-head"><h3>${escapeHtml(group.label)}</h3><b>${group.items.length}</b><small>${escapeHtml(group.description)}</small></header>
    <div class="want-group-items">${group.items.map((item) => wantRowMarkup(item, today)).join("")}</div>
  </section>`).join("");
  els.cardList.querySelectorAll(".want-row").forEach((row) => row.addEventListener("click", () => openDrawer(Number(row.dataset.id))));
}

export function renderList() {
  const items = currentItems();
  renderCurrentTabCount(items);
  els.listTitle.textContent = viewMeta[state.view].title;
  els.resultCount.textContent = `${items.length}件を表示`;
  els.clearFilter.hidden = state.view === "wants"
    ? !(state.status !== "active" || state.search || state.metricFilter || state.wantCategory)
    : !(state.status || state.search || state.metricFilter);
  const knowledgeActive = state.metricFilter === "knowledge";
  const githubActive = state.metricFilter === "github";
  // 登録待ちはWantsの絞り込み、Calendar再接続はToDoの操作なので、それぞれのタブでだけ出す。
  els.pendingFilterGroup.hidden = state.view !== "wants";
  els.pageUtilityToolbar.hidden = state.view !== "todos";
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
  els.todoLayoutGroup.hidden = state.view !== "todos";
  els.todoLayoutGroup.querySelectorAll("[data-todo-layout]").forEach((button) => {
    const active = button.dataset.todoLayout === state.todoLayout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderWantCategoryBar();
  els.cardList.classList.remove("backlog");
  if (isWantsBacklog()) {
    renderWantsBacklog(items);
    return;
  }
  if (state.view === "todos" && state.todoLayout === "calendar") {
    renderTodoCalendar(items);
    return;
  }
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
  state.wantCategory = "";
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
  // 保存後の再読み込みでも、選んでいた分類の絞り込みは残す。
  if (state.view !== route.view || route.filter) state.wantCategory = "";
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
