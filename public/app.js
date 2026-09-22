import { readApiJson } from "./api-client.js";
import { compassRoutePath, parseCompassRoute } from "./compass-routing.js";

const state = {
  data: null,
  view: "inbox",
  status: "pending",
  search: "",
  metricFilter: "",
  drawerItem: null,
  triageSource: "wants",
  inboxWant: null,
  aiRequestToken: 0,
  calendarConnection: null,
  todosLoaded: false,
  todoSource: null,
  bulkMode: false,
  bulkSelected: new Set(),
  bulkSubmitting: false,
  bulkError: "",
};

const els = Object.fromEntries([
  "sourceBadge", "refreshButton",
  "inboxTabCount", "wantsTabCount", "todosTabCount", "listTitle", "searchInput",
  "statusFilter", "pendingFilterGroup", "knowledgeFilter", "knowledgePendingCount", "githubFilter", "githubPendingCount", "todoFilterGroup", "resultCount", "clearFilter", "cardList", "drawerBackdrop",
  "bulkModeButton", "bulkToolbar", "bulkSelectAll", "bulkSelectionCount", "bulkStatusSelect", "bulkApplyButton", "bulkCancelButton", "bulkError",
  "drawer", "drawerClose", "drawerKicker", "drawerTitle", "drawerBody", "dashboardSwitcher", "dashboardNav",
  "addInboxButton", "inboxModal", "inboxModalClose", "inboxCancelButton", "inboxForm",
  "inboxContent", "inboxCharacterCount", "inboxFormError", "inboxSubmitButton", "toast",
].map((id) => [id, document.getElementById(id)]));

const viewMeta = {
  inbox: { title: "Inbox", singular: "Inbox", empty: "Inboxはすべて整理されています" },
  wants: { title: "Wants", singular: "Want", empty: "該当するWantsはありません" },
  todos: { title: "ToDo", singular: "ToDo", empty: "該当するToDoはありません" },
};

const defaultStatusByView = {
  inbox: "pending",
  wants: "active",
  todos: "pending",
};

const closedStatusesByView = {
  inbox: new Set(["done", "skipped", "completed", "closed", "cancelled", "archived"]),
  wants: new Set(["completed", "dropped", "done", "closed", "cancelled", "archived"]),
  todos: new Set(["completed", "skipped"]),
};

const itemEditMeta = {
  wants: {
    title: "Wantを編集",
    button: "Wantを編集",
    endpoint: "/api/wants",
    actionHeader: "want-update",
    statuses: ["active", "completed", "dropped"],
    success: "Wantを更新しました。",
  },
};

const closeMeta = {
  inbox: {
    endpoint: "/api/inbox",
    actionHeader: "inbox-update",
    closedStatus: "done",
    button: "Inboxをクローズ",
    confirm: "このInboxをクローズしますか？\n\nクローズ後も、ステータスフィルターから確認・再開できます。",
    success: "Inboxをクローズしました。",
  },
  wants: {
    endpoint: "/api/wants",
    actionHeader: "want-update",
    closedStatus: "completed",
    button: "Wantをクローズ",
    confirm: "このWantをクローズしますか？\n\nクローズ後も、ステータスフィルターから確認・再開できます。",
    success: "Wantをクローズしました。",
  },
};

const DEFER_ROUTE = "defer";
const WISH_ROUTE = "wish";

const inboxQuickRoutes = {
  calendar: { label: "予定", description: "日付を決めて動く", intent: "act", destination: "calendar" },
  wish: { label: "欲しい", description: "欲しいものとして残す" },
  writing: { label: "考える", description: "Writingで考えを育てる", intent: "explore", destination: "writing" },
  knowledge: { label: "調べる", description: "Knowledge候補として残す", intent: "explore", destination: "knowledge" },
  habit: { label: "習慣", description: "繰り返す行動にする", intent: "continue", destination: "habit" },
  focus: { label: "Focus", description: "意識し続ける", intent: "keep", destination: "focus" },
  github: { label: "作りたい", description: "GitHub候補として残す", intent: "act", destination: "github" },
  journal: { label: "気分", description: "Journal候補として残す", intent: "keep", destination: "journal" },
  defer: { label: "寝かせる", description: "再訪日を決めて置く" },
};

const routeIntentMeta = {
  act: { label: "行動する", description: "日時を確保する、またはソフトウェアを変更する" },
  continue: { label: "継続する", description: "繰り返したい行動として管理する" },
  explore: { label: "掘り下げる", description: "調べる、理解する、文章へ育てる" },
  keep: { label: "残しておく", description: "意識事項や記録として保存する" },
  discard: { label: "今回は見送る", description: "理由を残して整理を終える" },
};

const routeDestinationMeta = {
  wish: { label: "欲しい", description: "欲しいものとしてWantsに残す", internal: true },
  calendar: { label: "Google Calendar", description: "タスク・予定・調査時間をメインカレンダーへ登録", internal: false },
  github: { label: "GitHub Issue", description: "ソフトウェアの実装候補として保存", internal: false },
  writing: { label: "Writing", description: "掘り下げたいエッセイ候補として登録", internal: true },
  habit: { label: "Habits", description: "継続する習慣として登録", internal: true },
  knowledge: { label: "Knowledge候補", description: "調査・検証後のDB登録候補として保存", internal: false },
  focus: { label: "Focus", description: "繰り返し意識したい言葉として登録", internal: true },
  journal: { label: "Journal候補", description: "その日の記録として保存する計画", internal: false },
  archive: { label: "アーカイブ", description: "外部へ登録せず整理記録だけを残す", internal: true },
};

const destinationsByIntent = {
  act: ["calendar", "github"],
  continue: ["habit"],
  explore: ["calendar", "knowledge", "writing"],
  keep: ["focus", "journal", "archive"],
  discard: ["archive"],
};

const quickWantRoutes = {
  calendar: { label: "予定", description: "日付を決めて動く", intent: "act", destination: "calendar" },
  writing: { label: "考える", description: "Writingで考えを育てる", intent: "explore", destination: "writing" },
  knowledge: { label: "調べる", description: "Knowledge候補として残す", intent: "explore", destination: "knowledge" },
  habit: { label: "習慣", description: "繰り返す行動にする", intent: "continue", destination: "habit" },
  focus: { label: "Focus", description: "意識し続ける", intent: "keep", destination: "focus" },
  github: { label: "作りたい", description: "GitHub候補として残す", intent: "act", destination: "github" },
  journal: { label: "気分", description: "Journal候補として残す", intent: "keep", destination: "journal" },
  archive: { label: "Archive", description: "今回は見送る", intent: "discard", destination: "archive" },
};

const cadenceLabels = {
  daily: "毎日",
  weekdays: "平日",
  weekly: "毎週",
  flexible: "頻度を固定しない",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, includeTime = false) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", includeTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }
  ).format(date);
}

function calendarSchedule(value) {
  const schedule = value?.calendar;
  if (!schedule || schedule.timeZone !== "Asia/Tokyo" || typeof schedule.date !== "string") return null;
  return schedule;
}

function formatCalendarSchedule(schedule) {
  if (!schedule) return "日時未設定";
  const date = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" })
    .format(new Date(`${schedule.date}T00:00:00+09:00`));
  return schedule.allDay ? `${date}（終日）` : `${date} ${schedule.startTime}–${schedule.endTime}`;
}

function todoTiming(item, now = new Date()) {
  if (item.calendarState === "missing" || item.calendarState === "cancelled") return "overdue";
  const schedule = item.schedule;
  if (!schedule?.date) return "overdue";
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (schedule.date < today) return "overdue";
  if (schedule.date > today) return "upcoming";
  if (schedule.allDay) return "today";
  const end = new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime() ? "overdue" : "today";
}

function sortTodos(items) {
  const rank = { overdue: 0, today: 1, upcoming: 2 };
  return [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === "pending" ? -1 : right.status === "pending" ? 1 : 0;
    const timingDifference = (rank[todoTiming(left)] ?? 3) - (rank[todoTiming(right)] ?? 3);
    if (timingDifference) return timingDifference;
    const leftSchedule = `${left.schedule?.date || "9999-12-31"}T${left.schedule?.startTime || "00:00"}`;
    const rightSchedule = `${right.schedule?.date || "9999-12-31"}T${right.schedule?.startTime || "00:00"}`;
    return leftSchedule.localeCompare(rightSchedule) || right.id - left.id;
  });
}

function todoTimingLabel(item) {
  if (item.calendarState === "missing") return "Calendar予定なし";
  if (item.calendarState === "cancelled") return "Calendarで取消済み";
  return ({ overdue: "実施確認待ち", today: "今日", upcoming: "今後" })[todoTiming(item)];
}

async function refreshGoogleCalendarConnection(statusElement, submitButton) {
  statusElement.className = "integration-status loading";
  statusElement.textContent = "Google Calendarの接続状態を確認しています…";
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/google-calendar-status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "Google Calendarの接続状態を確認できませんでした。");
    state.calendarConnection = payload;
    if (!payload.configured) {
      statusElement.className = "integration-status error";
      statusElement.textContent = "Google Calendar連携のサーバー設定が未完了です。";
      return;
    }
    if (!payload.connected) {
      statusElement.className = "integration-status action";
      statusElement.innerHTML = '<span>Google Calendarはまだ接続されていません。</span><a href="/api/google-calendar-connect">Google Calendarを接続</a>';
      return;
    }
    statusElement.className = "integration-status connected";
    statusElement.innerHTML = '<span>接続済み · メインカレンダー · Asia/Tokyo</span><a href="/api/google-calendar-connect">Google Calendarを再接続</a>';
    submitButton.disabled = false;
  } catch (error) {
    state.calendarConnection = null;
    statusElement.className = "integration-status error";
    statusElement.textContent = error instanceof Error ? error.message : "Google Calendarの接続状態を確認できませんでした。";
  }
}

function setSource(source, error = false) {
  els.sourceBadge.className = "source-badge";
  if (error) {
    els.sourceBadge.classList.add("error");
    els.sourceBadge.lastChild.textContent = "接続エラー";
    return;
  }
  const demo = source.state === "demo";
  els.sourceBadge.classList.add(demo ? "demo" : "live");
  els.sourceBadge.lastChild.textContent = demo ? "DEMO DATA" : "SUPABASE LIVE";
}

function currentItems() {
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

function updateStatusOptions() {
  const items = state.data?.[state.view] || [];
  const statuses = [...new Set(items.map((item) => item.status))].sort();
  els.statusFilter.innerHTML = '<option value="">すべてのステータス</option>'
    + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</option>`).join("");
  els.statusFilter.value = state.status;
}

function renderSummary() {
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

function renderNavigation(items) {
  els.dashboardNav.innerHTML = items.map((item) => {
    const label = escapeHtml(item.label);
    if (item.current) return `<span class="current">${label}<small>CURRENT</small></span>`;
    if (!item.url) return `<span class="unavailable">${label}<small>SOON</small></span>`;
    return `<a href="${escapeHtml(item.url)}">${label}<small>OPEN</small></a>`;
  }).join("");
}

function statusLabel(status, view = state.view) {
  if (view === "todos") return ({ pending: "未実施", completed: "完了", skipped: "見送り" })[status] || status;
  return ({ pending: "未整理", done: "整理済み", skipped: "対象外", active: "未整理", completed: "整理済み", dropped: "見送り", closed: "完了" })[status] || status;
}

function itemStatusLabel(item, view = state.view) {
  if (view === "wants" && item.status === "active" && item.type === "wish") return "欲しい";
  if (view === "wants" && item.status === "active" && item.revisitOn && item.revisitOn > todayInTokyo()) return "寝かせ中";
  return statusLabel(item.status);
}

function canCloseItem(item, view) {
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

function clearBulkSelection() {
  state.bulkSelected.clear();
  state.bulkError = "";
}

function setBulkMode(active) {
  state.bulkMode = Boolean(active) && state.view === "inbox";
  state.bulkSubmitting = false;
  clearBulkSelection();
  renderList();
}

function renderBulkControls(items) {
  const inboxView = state.view === "inbox";
  const active = inboxView && state.bulkMode;
  els.bulkModeButton.hidden = !inboxView || active || items.length === 0;
  els.bulkToolbar.hidden = !active;
  if (!active) return;

  const visibleIds = items.map((item) => item.id).filter((id) => Number.isSafeInteger(id));
  const selectedVisible = visibleIds.filter((id) => state.bulkSelected.has(id));
  els.bulkSelectionCount.textContent = `${state.bulkSelected.size}件選択`;
  els.bulkSelectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  els.bulkSelectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  els.bulkApplyButton.disabled = state.bulkSubmitting || state.bulkSelected.size === 0;
  els.bulkCancelButton.disabled = state.bulkSubmitting;
  els.bulkStatusSelect.disabled = state.bulkSubmitting;
  els.bulkError.textContent = state.bulkError;
  els.bulkError.hidden = !state.bulkError;
}

function renderList() {
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

async function applyInboxBulkUpdate() {
  const selected = (state.data?.inbox || []).filter((item) => state.bulkSelected.has(item.id));
  if (!selected.length || state.bulkSubmitting) return;
  const nextStatus = els.bulkStatusSelect.value;
  const nextLabel = statusLabel(nextStatus, "inbox");
  if (!window.confirm(`${selected.length}件のInboxを「${nextLabel}」に変更しますか？\n\n既存の内容と整理結果はそのまま残ります。`)) return;

  state.bulkSubmitting = true;
  state.bulkError = "";
  renderBulkControls(currentItems());
  try {
    const response = await fetch("/api/inbox-bulk", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "inbox-bulk-update",
      },
      body: JSON.stringify({
        status: nextStatus,
        items: selected.map((item) => ({
          id: item.id,
          original: { content: item.content, status: item.status, result: item.result ?? null },
        })),
      }),
    });
    const payload = await readApiJson(response);
    if (!response.ok && response.status !== 207) throw new Error(payload.error || "Inboxを一括変更できませんでした。");
    const updated = Array.isArray(payload.updated) ? payload.updated : [];
    const failed = Array.isArray(payload.failed) ? payload.failed : [];
    state.bulkSubmitting = false;
    if (failed.length) {
      const failedIds = failed.map((item) => Number(item.id)).filter(Number.isSafeInteger);
      const errorMessage = `${updated.length}件を変更しました。変更できなかったInbox: ${failed.map((item) => `#${item.id}`).join("、")}`;
      await loadDashboard();
      state.bulkMode = true;
      state.bulkSelected = new Set(failedIds);
      state.bulkError = errorMessage;
      renderList();
      return;
    }
    state.bulkMode = false;
    clearBulkSelection();
    await loadDashboard();
    showToast(`${updated.length}件のInboxを「${nextLabel}」に変更しました。`);
  } catch (error) {
    state.bulkSubmitting = false;
    state.bulkError = error instanceof Error ? error.message : "Inboxを一括変更できませんでした。";
    renderList();
  }
}

function triageSourceLabel(view = state.triageSource) {
  return view === "inbox" ? "元のInbox" : "元のWant";
}

function triageKicker(item, view = state.triageSource) {
  return `${viewMeta[view].singular} · ${item.id}`;
}

function triageCompletionNote(view = state.triageSource) {
  return view === "inbox" ? "元のInboxを整理済みにします。" : "元のWantも完了します。";
}

function defaultRevisitDate() {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = today.getUTCDate();
  const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day));
  if (target.getUTCDate() !== day) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

function todayInTokyo() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function renderDrawerItem(item, view) {
  if (view === "todos") {
    renderTodoDrawer(item);
    return;
  }
  state.triageSource = view;
  els.drawerKicker.textContent = `${viewMeta[view].singular} · ${item.id}`;
  els.drawerTitle.textContent = item.content || "内容なし";
  let body = `<div class="detail-grid">
    <div class="detail-box"><span>Status</span><strong>${escapeHtml(itemStatusLabel(item, view))}</strong></div>
    <div class="detail-box"><span>Created</span><strong>${escapeHtml(formatDate(item.createdAt, true))}</strong></div>
  </div>`;
  if (view === "inbox") {
    const quickRouteMarkup = item.status === "pending"
      ? `<div class="detail-section quick-route-section">
          <span>扱いを決める</span>
          <p>選ぶとそのまま入力画面へ進みます。迷う場合は「整理する」。</p>
          <div class="quick-route-actions" role="group" aria-label="Inboxの扱い">
            ${Object.entries(inboxQuickRoutes).map(([key, quick]) => `<button class="quick-route-action" type="button" data-inbox-route="${key}"><strong>${escapeHtml(quick.label)}</strong><small>${escapeHtml(quick.description)}</small></button>`).join("")}
          </div>
          <div class="project-route-divider"><span>複数の行動になるなら</span></div>
          <button class="project-route-action" type="button" data-project-route><strong>Projectとして進める</strong><small>完了条件と最初のNext Actionを決める</small></button>
        </div>`
      : "";
    body += `<div class="detail-section"><span>整理結果</span><p>${escapeHtml(item.result || "まだ整理されていません")}</p></div>
      ${quickRouteMarkup}
      <div class="drawer-actions">
        <button class="secondary-action" id="editInboxButton" type="button">Inboxを編集</button>
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Inboxをクローズ</button>' : ""}
        ${item.status === "pending" ? '<button class="primary-action" id="triageInboxButton" type="button">整理する</button>' : ""}
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
  }
  if (view === "wants") {
    const routes = item.routes || [];
    const quickRouteMarkup = item.status === "active"
      ? `<div class="detail-section quick-route-section">
          <span>クイック操作</span>
          <p>よく使う振り分け先から、入力画面へ直接進めます。</p>
          <div class="quick-route-actions" role="group" aria-label="よく使う振り分け">
            ${Object.entries(quickWantRoutes).map(([key, quick]) => `<button class="quick-route-action" type="button" data-quick-route="${key}"><strong>${escapeHtml(quick.label)}</strong><small>${escapeHtml(quick.description)}</small></button>`).join("")}
          </div>
          <div class="project-route-divider"><span>複数の行動になるなら</span></div>
          <button class="project-route-action" type="button" data-project-route><strong>Projectとして進める</strong><small>既存のProjectへ紐づけることもできます</small></button>
        </div>`
      : "";
    const routeMarkup = routes.length > 0
      ? `<ul class="route-list">${routes.map((route) => {
          const meta = routeDestinationMeta[route.destination] || { label: route.destination, internal: false };
          const status = ({ planned: "計画のみ", created: "登録済み", failed: "失敗", cancelled: "取消" })[route.status] || route.status;
          const target = route.targetUrl
            ? `<a href="${escapeHtml(route.targetUrl)}" target="_blank" rel="noopener noreferrer">正本を開く</a>`
            : "";
          const schedule = route.destination === "calendar" ? calendarSchedule(route.destinationData) : null;
          const completeAction = route.destination === "knowledge" && route.status === "planned"
            ? `<button class="route-action" type="button" data-knowledge-complete="${route.id}">Knowledge登録済みにする</button>`
            : "";
          return `<li><div><strong>${escapeHtml(meta.label)}</strong><span class="route-status route-status-${escapeHtml(route.status)}">${escapeHtml(status)}</span></div><p>${escapeHtml(route.title)}</p>${schedule ? `<small>${escapeHtml(formatCalendarSchedule(schedule))}</small>` : ""}${target}${completeAction}</li>`;
        }).join("")}</ul>`
      : '<p class="route-empty">まだ振り分けられていません。</p>';
    body += `${item.note ? `<div class="detail-section"><span>メモ</span><p>${escapeHtml(item.note)}</p></div>` : ""}
      ${quickRouteMarkup}
      <div class="detail-section"><span>振り分け履歴</span>${routeMarkup}</div>
      <div class="drawer-actions">
        <button class="secondary-action" id="editWantButton" type="button">Wantを編集</button>
        ${item.status === "active" ? '<button class="primary-action" id="triageWantButton" type="button">整理する</button>' : ""}
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Wantをクローズ</button>' : ""}
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
  }
  els.drawerBody.innerHTML = body;
  document.getElementById("editInboxButton")?.addEventListener("click", () => renderInboxEditForm(item));
  document.getElementById("triageInboxButton")?.addEventListener("click", () => renderTriageStart(item));
  els.drawerBody.querySelectorAll("[data-inbox-route]").forEach((button) => button.addEventListener("click", () => startInboxRoute(item, button.dataset.inboxRoute)));
  document.getElementById("editWantButton")?.addEventListener("click", () => renderItemEditForm(item, "wants"));
  document.getElementById("triageWantButton")?.addEventListener("click", () => renderTriageStart(item));
  els.drawerBody.querySelectorAll("[data-quick-route]").forEach((button) => button.addEventListener("click", () => startQuickWantRoute(item, button.dataset.quickRoute)));
  els.drawerBody.querySelector("[data-project-route]")?.addEventListener("click", () => startProjectRoute(item, view));
  els.drawerBody.querySelectorAll("[data-knowledge-complete]").forEach((button) => button.addEventListener("click", () => {
    const route = (item.routes || []).find((entry) => entry.id === Number(button.dataset.knowledgeComplete));
    if (route) renderKnowledgeCompletion(item, route);
  }));
  document.getElementById("closeItemButton")?.addEventListener("click", () => closeItem(item, view));
}

function todoCalendarNotice(item) {
  if (item.calendarState === "unavailable") return "Google Calendarへ接続できないため、前回確認した日時を表示しています。再読み込み後に日程を変更してください。";
  if (item.calendarState === "missing") return "紐づくGoogle Calendar予定が見つかりません。実施する場合は新しい予定として再作成できます。";
  if (item.calendarState === "cancelled") return "Google Calendarでは取消済みです。見送るか、新しい予定として再作成してください。";
  if (item.status === "pending" && todoTiming(item) === "overdue") return "予定時刻を過ぎています。実施済みか、日程を決め直すか、見送るかを選んでください。";
  return "日時変更はGoogle Calendarへ反映されます。完了・見送りはToDoだけを更新し、Calendar予定は変更しません。";
}

function renderTodoDrawer(item) {
  els.drawerKicker.textContent = `ToDo · ${item.id}`;
  els.drawerTitle.textContent = item.title || "内容なし";
  const canReschedule = item.status === "pending" && item.calendarState === "confirmed" && item.calendarEtag;
  const calendarLink = item.calendarUrl
    ? `<a class="secondary-action action-link" href="${escapeHtml(item.calendarUrl)}" target="_blank" rel="noopener noreferrer">Google Calendarで開く</a>`
    : "";
  const actions = item.status === "pending"
    ? `<button class="primary-action" id="completeTodoButton" type="button">完了にする</button>
       <button class="secondary-action" id="rescheduleTodoButton" type="button" ${canReschedule ? "" : "disabled"}>日程を決め直す</button>
       ${item.calendarState === "missing" || item.calendarState === "cancelled" ? '<button class="secondary-action" id="recreateTodoButton" type="button">新しい予定として再作成</button>' : ""}
       <button class="close-action" id="skipTodoButton" type="button">見送る</button>`
    : `<button class="secondary-action" id="reopenTodoButton" type="button">未実施に戻す</button>`;
  els.drawerBody.innerHTML = `<div class="detail-grid">
      <div class="detail-box"><span>Status</span><strong>${escapeHtml(item.status === "pending" ? todoTimingLabel(item) : statusLabel(item.status, "todos"))}</strong></div>
      <div class="detail-box"><span>Schedule</span><strong>${escapeHtml(formatCalendarSchedule(item.schedule))}</strong></div>
    </div>
    ${item.detail ? `<div class="detail-section"><span>補足</span><p>${escapeHtml(item.detail)}</p></div>` : ""}
    <div class="detail-section todo-source"><span>元の記録</span><p>Want · ${item.sourceWantId}${item.sourceInboxId ? ` / Inbox · ${item.sourceInboxId}` : ""}</p></div>
    <div class="todo-notice ${item.status === "pending" && todoTiming(item) === "overdue" ? "attention" : ""}">${escapeHtml(todoCalendarNotice(item))}</div>
    <label class="form-field todo-note" for="todoNote"><span>実施メモ <small>空欄可</small></span><textarea id="todoNote" rows="4" maxlength="2000" placeholder="実施結果や見送り理由">${escapeHtml(item.note || "")}</textarea></label>
    <div class="drawer-actions">${calendarLink}${actions}</div>
    <p class="form-error" id="todoActionError" role="alert" hidden></p>`;
  document.getElementById("completeTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "complete"));
  document.getElementById("skipTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "skip"));
  document.getElementById("reopenTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "reopen"));
  document.getElementById("rescheduleTodoButton")?.addEventListener("click", () => renderTodoRescheduleForm(item));
  document.getElementById("recreateTodoButton")?.addEventListener("click", () => renderTodoRescheduleForm(item, "recreate"));
}

function setTodoActionError(message) {
  const error = document.getElementById("todoActionError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function todoRequestBody(item, command, options = {}) {
  return {
    id: item.id,
    command,
    note: options.note ?? null,
    schedule: options.schedule ?? null,
    original: {
      status: item.status,
      updatedAt: item.updatedAt,
      calendarEtag: item.calendarEtag,
      schedule: item.schedule,
    },
  };
}

async function sendTodoUpdate(item, command, options = {}) {
  const response = await fetch("/api/scheduled-actions", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "scheduled-todo-update",
    },
    body: JSON.stringify(todoRequestBody(item, command, options)),
  });
  const payload = await readApiJson(response);
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "ToDoを更新できませんでした。");
  return payload;
}

async function changeTodoStatus(item, command) {
  const button = document.getElementById(`${command === "complete" ? "complete" : command === "skip" ? "skip" : "reopen"}TodoButton`);
  if (!button) return;
  const note = document.getElementById("todoNote")?.value.trim() || null;
  button.disabled = true;
  setTodoActionError("");
  try {
    await sendTodoUpdate(item, command, { note });
    hideDrawer();
    syncCompassRoute("todos", null, "replace", ["overdue", "today", "upcoming"].includes(state.metricFilter) ? state.metricFilter : null);
    await loadTodos(true);
    showToast(command === "complete" ? "ToDoを完了しました。" : command === "skip" ? "ToDoを見送りにしました。" : "ToDoを未実施に戻しました。");
  } catch (error) {
    setTodoActionError(error instanceof Error ? error.message : "ToDoを更新できませんでした。");
    if (button.isConnected) button.disabled = false;
  }
}

function dateOffset(days) {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextWeekendDate() {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 6 ? 7 : (6 - day + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

function renderTodoRescheduleForm(item, command = "reschedule") {
  const schedule = item.schedule;
  const recreate = command === "recreate";
  els.drawerKicker.textContent = `ToDo · ${item.id}`;
  els.drawerTitle.textContent = recreate ? "Calendar予定を再作成" : "日程を決め直す";
  els.drawerBody.innerHTML = `<form class="edit-form" id="todoRescheduleForm">
    <div class="source-context"><span>対象</span><p>${escapeHtml(item.title)}</p></div>
    <div class="quick-date-actions" role="group" aria-label="日付の候補">
      <button class="filter-chip" type="button" data-quick-date="${dateOffset(0)}">今日</button>
      <button class="filter-chip" type="button" data-quick-date="${dateOffset(1)}">明日</button>
      <button class="filter-chip" type="button" data-quick-date="${nextWeekendDate()}">今週末</button>
    </div>
    <label class="form-field" for="todoScheduleDate"><span>日付</span><input id="todoScheduleDate" name="date" type="date" min="${todayInTokyo()}" value="${escapeHtml(schedule.date)}" required></label>
    <label class="calendar-all-day" for="todoScheduleAllDay"><input id="todoScheduleAllDay" name="allDay" type="checkbox" ${schedule.allDay ? "checked" : ""}><span>終日予定</span></label>
    <div class="calendar-time-fields" id="todoScheduleTimeFields" ${schedule.allDay ? "hidden" : ""}>
      <label class="form-field" for="todoScheduleStart"><span>開始</span><input id="todoScheduleStart" name="startTime" type="time" value="${escapeHtml(schedule.startTime || "09:00")}"></label>
      <label class="form-field" for="todoScheduleEnd"><span>終了</span><input id="todoScheduleEnd" name="endTime" type="time" value="${escapeHtml(schedule.endTime || "09:30")}"></label>
    </div>
    <p class="route-boundary">${recreate ? "削除・取消済みの予定とは別に、新しいGoogle Calendar予定を1件作成してこのToDoへ再接続します。" : "同じGoogle Calendar予定の日時だけを更新します。新しい予定は作成しません。"}</p>
    <p class="form-error" id="todoActionError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="cancelTodoReschedule" type="button">戻る</button><button class="primary-action" id="saveTodoReschedule" type="submit">${recreate ? "新しい予定を作成" : "Calendarの日程を更新"}</button></div>
  </form>`;
  const form = document.getElementById("todoRescheduleForm");
  const allDay = document.getElementById("todoScheduleAllDay");
  const timeFields = document.getElementById("todoScheduleTimeFields");
  const syncTimeRequirement = () => {
    timeFields.hidden = allDay.checked;
    form.elements.startTime.required = !allDay.checked;
    form.elements.endTime.required = !allDay.checked;
  };
  allDay.addEventListener("change", syncTimeRequirement);
  syncTimeRequirement();
  form.querySelectorAll("[data-quick-date]").forEach((button) => button.addEventListener("click", () => {
    form.elements.date.value = button.dataset.quickDate;
  }));
  document.getElementById("cancelTodoReschedule").addEventListener("click", () => renderTodoDrawer(item));
  form.addEventListener("submit", (event) => saveTodoReschedule(event, item, command));
}

async function saveTodoReschedule(event, item, command = "reschedule") {
  event.preventDefault();
  const form = event.currentTarget;
  const allDay = form.elements.allDay.checked;
  const schedule = {
    allDay,
    date: form.elements.date.value,
    startTime: allDay ? null : form.elements.startTime.value,
    endTime: allDay ? null : form.elements.endTime.value,
    timeZone: "Asia/Tokyo",
  };
  if (!schedule.date || (!allDay && (!schedule.startTime || !schedule.endTime || schedule.endTime <= schedule.startTime))) {
    setTodoActionError("新しい日付と時間を確認してください。");
    return;
  }
  const end = allDay ? new Date(`${schedule.date}T23:59:59+09:00`) : new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
    setTodoActionError("実施予定は現在より後の日時を指定してください。");
    return;
  }
  const submit = document.getElementById("saveTodoReschedule");
  const cancel = document.getElementById("cancelTodoReschedule");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "更新中…";
  setTodoActionError("");
  try {
    await sendTodoUpdate(item, command, { schedule });
    hideDrawer();
    syncCompassRoute("todos", null, "replace", ["overdue", "today", "upcoming"].includes(state.metricFilter) ? state.metricFilter : null);
    await loadTodos(true);
    showToast(command === "recreate" ? "Google Calendarへ新しい予定を作成しました。" : "Google Calendarの日程を更新しました。");
  } catch (error) {
    setTodoActionError(error instanceof Error ? error.message : "日程を変更できませんでした。");
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = command === "recreate" ? "新しい予定を作成" : "Calendarの日程を更新";
    }
  }
}

function startQuickWantRoute(item, key) {
  const quick = quickWantRoutes[key];
  if (item.status !== "active" || !quick) return;
  renderRouteForm(item, quick.intent, quick.destination, {}, "quick");
}

function startInboxRoute(item, key) {
  if (item.status !== "pending") return;
  if (key === DEFER_ROUTE) {
    renderDeferForm(item);
    return;
  }
  if (key === WISH_ROUTE) {
    renderWishForm(item);
    return;
  }
  const quick = inboxQuickRoutes[key];
  if (!quick) return;
  renderRouteForm(item, quick.intent, quick.destination, {}, "quick");
}

function projectSourceSnapshot(item, view) {
  return {
    type: view === "inbox" ? "inbox" : "want",
    id: item.id,
    content: item.content,
    status: item.status,
    result: view === "inbox" ? item.result ?? null : null,
  };
}

async function startProjectRoute(item, view) {
  const requestToken = ++state.aiRequestToken;
  state.triageSource = view;
  els.drawerKicker.textContent = triageKicker(item, view);
  els.drawerTitle.textContent = "Projectとして進める";
  els.drawerBody.innerHTML = `<div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span><p>${escapeHtml(item.content)}</p></div>
    <div class="ai-loading" role="status"><span aria-hidden="true"></span><p>Projectを確認しています…</p></div>`;

  try {
    const response = await fetch("/api/projects", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : "Projectを読み込めませんでした。";
    if (!response.ok || !Array.isArray(payload.projects)) throw new Error(message);
    if (requestToken !== state.aiRequestToken) return;
    renderProjectRouteForm(item, view, payload.projects.filter((project) => !["completed", "dropped"].includes(project.status)));
  } catch (error) {
    if (requestToken !== state.aiRequestToken) return;
    els.drawerBody.innerHTML = `<div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span><p>${escapeHtml(item.content)}</p></div>
      <div class="integration-status error"><strong>Projectを確認できませんでした</strong><span>${escapeHtml(error instanceof Error ? error.message : "時間をおいて再試行してください。")}</span></div>
      <div class="drawer-actions"><button class="secondary-action" id="cancelProjectRoute" type="button">戻る</button><button class="primary-action" id="retryProjectRoute" type="button">再試行</button></div>`;
    document.getElementById("cancelProjectRoute").addEventListener("click", () => renderDrawerItem(item, view));
    document.getElementById("retryProjectRoute").addEventListener("click", () => startProjectRoute(item, view));
  }
}

function renderProjectRouteForm(item, view, projects) {
  const title = item.content.slice(0, 240);
  const options = projects.map((project) => {
    const action = project.nextAction?.content || "Next Action要確認";
    return `<option value="${project.id}">${escapeHtml(project.title)} — ${escapeHtml(action)}</option>`;
  }).join("");
  els.drawerBody.innerHTML = `<form class="edit-form project-route-form" id="projectRouteForm">
    <div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span><p>${escapeHtml(item.content)}</p></div>
    <p class="route-boundary">元のデータは消さずにProjectへリンクし、${escapeHtml(triageCompletionNote(view))}</p>
    <fieldset class="project-mode-options">
      <legend>整理先</legend>
      <label><input type="radio" name="projectMode" value="create" checked /> 新しいProjectを作る</label>
      <label><input type="radio" name="projectMode" value="link" ${projects.length ? "" : "disabled"} /> 既存のProjectへ入れる</label>
    </fieldset>
    <div class="project-mode-section" data-project-mode-section="create">
      <label class="form-field"><span>Project名 <b>必須</b></span><input name="projectTitle" type="text" maxlength="240" value="${escapeHtml(title)}" required /></label>
      <label class="form-field"><span>完了条件 <b>必須</b></span><textarea name="projectOutcome" maxlength="2000" rows="3" placeholder="何ができたら、このProjectは完了ですか？" required></textarea></label>
      <label class="form-field"><span>最初のNext Action <b>必須</b></span><textarea name="projectNextAction" maxlength="500" rows="2" placeholder="目で見て着手できる、次の具体的な一手" required></textarea></label>
      <div class="project-optional-fields">
        <label class="form-field"><span>テーマ</span><input name="projectTheme" type="text" maxlength="120" placeholder="任意" /></label>
        <label class="form-field"><span>目標日</span><input name="projectTargetOn" type="date" /></label>
      </div>
    </div>
    <div class="project-mode-section" data-project-mode-section="link" hidden>
      <label class="form-field"><span>Project <b>必須</b></span><select name="projectId" ${projects.length ? "" : "disabled"}>${options || '<option value="">進行中のProjectがありません</option>'}</select></label>
      <p class="flow-note">「未整理」として追加し、Project一覧の「要確認」に表示します。現在のNext Actionは勝手に変更しません。</p>
    </div>
    <p class="form-error" id="projectRouteError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="cancelProjectRoute" type="button">戻る</button><button class="primary-action" id="saveProjectRoute" type="submit">Projectへ整理</button></div>
  </form>`;

  const form = document.getElementById("projectRouteForm");
  const errorElement = document.getElementById("projectRouteError");
  const submit = document.getElementById("saveProjectRoute");
  const cancel = document.getElementById("cancelProjectRoute");
  const updateMode = () => {
    const mode = form.elements.projectMode.value;
    form.querySelectorAll("[data-project-mode-section]").forEach((section) => {
      const active = section.dataset.projectModeSection === mode;
      section.hidden = !active;
      section.querySelectorAll("input, select, textarea").forEach((field) => {
        field.disabled = !active || (field.name === "projectId" && !projects.length);
      });
    });
  };
  form.querySelectorAll('input[name="projectMode"]').forEach((radio) => radio.addEventListener("change", updateMode));
  updateMode();
  cancel.addEventListener("click", () => renderDrawerItem(item, view));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "整理中…";
    const mode = form.elements.projectMode.value;
    const source = projectSourceSnapshot(item, view);
    let body;
    if (mode === "link") {
      const project = projects.find((candidate) => candidate.id === Number(form.elements.projectId.value));
      if (!project) {
        errorElement.textContent = "紐づけ先のProjectを選んでください。";
        errorElement.hidden = false;
        submit.disabled = false;
        cancel.disabled = false;
        submit.textContent = "Projectへ整理";
        return;
      }
      body = { operation: "link", source, projectId: project.id, originalProjectUpdatedAt: project.updatedAt };
    } else {
      body = {
        operation: "create",
        source,
        title: form.elements.projectTitle.value.trim(),
        outcome: form.elements.projectOutcome.value.trim(),
        theme: form.elements.projectTheme.value.trim() || null,
        targetOn: form.elements.projectTargetOn.value || null,
        nextAction: form.elements.projectNextAction.value.trim(),
      };
    }

    try {
      const response = await fetch("/api/project-source", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-source-route",
        },
        body: JSON.stringify(body),
      });
      const payload = await readApiJson(response);
      const message = typeof payload.error === "string" ? payload.error : "Projectへ整理できませんでした。";
      if (!response.ok || !Number.isSafeInteger(Number(payload.projectId))) throw new Error(message);
      hideDrawer();
      syncCompassRoute(view, null, "replace", state.metricFilter);
      const refreshed = await loadDashboard();
      showToast(refreshed
        ? `${viewMeta[view].singular}をProjectへ整理しました。Projectsで次の一手を確認できます。`
        : "Projectへの整理は完了しました。画面を再読み込みしてください。");
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : "Projectへ整理できませんでした。";
      errorElement.hidden = false;
    } finally {
      if (submit.isConnected) {
        submit.disabled = false;
        cancel.disabled = false;
        submit.textContent = "Projectへ整理";
      }
    }
  });
}

function renderTriageStart(item) {
  els.drawerKicker.textContent = triageKicker(item);
  els.drawerTitle.textContent = `この${viewMeta[state.triageSource].singular}をどう扱いますか？`;
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel())}</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-triage-entry">
      <button class="ai-triage-button" id="askAiTriageButton" type="button">AIに整理案を聞く</button>
      <p class="ai-data-note">押した時だけ、本文をClaude APIへ送信します。AIは案を作るだけで、外部登録は行いません。</p>
    </div>
    <div class="triage-divider"><span>または自分で選ぶ</span></div>
    <div class="triage-options" id="triageIntentOptions">
      ${Object.entries(routeIntentMeta).map(([key, meta]) => `<button class="triage-option" type="button" data-intent="${key}"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.description)}</span></button>`).join("")}
    </div>
    <div class="drawer-actions"><button class="secondary-action" id="cancelTriage" type="button">戻る</button></div>`;
  document.getElementById("askAiTriageButton").addEventListener("click", () => requestAiTriage(item));
  document.querySelectorAll("[data-intent]").forEach((button) => button.addEventListener("click", () => renderDestinationStep(item, button.dataset.intent)));
  document.getElementById("cancelTriage").addEventListener("click", () => renderDrawerItem(item, state.triageSource));
}

async function requestAiTriage(item, answers = null) {
  const requestToken = ++state.aiRequestToken;
  const sourceView = state.triageSource;
  els.drawerKicker.textContent = triageKicker(item, sourceView);
  els.drawerTitle.textContent = "AIが整理案を作成中";
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel(sourceView))}</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-loading" role="status"><span aria-hidden="true"></span><p>内容に合う振り分け先を考えています…</p></div>`;
  try {
    const response = await fetch("/api/want-suggestions", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-ai-suggest",
      },
      body: JSON.stringify({
        source: sourceView === "inbox" ? "inbox" : "want",
        sourceId: item.id,
        content: item.content,
        answers,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "AI整理案を取得できませんでした。");
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== sourceView) return;
    renderAiSuggestion(item, payload);
  } catch (error) {
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== sourceView) return;
    els.drawerTitle.textContent = "AI整理案を取得できませんでした";
    els.drawerBody.innerHTML = `<div class="source-context">
        <span>${escapeHtml(triageSourceLabel(sourceView))}</span>
        <p>${escapeHtml(item.content)}</p>
      </div>
      <p class="form-error" role="alert">${escapeHtml(error instanceof Error ? error.message : "AI整理案を取得できませんでした。")}</p>
      <p class="ai-data-note">${escapeHtml(viewMeta[sourceView].singular)}は変更されていません。手動の振り分けはそのまま利用できます。</p>
      <div class="drawer-actions"><button class="secondary-action" id="manualTriageAfterAiError" type="button">手動で選ぶ</button><button class="primary-action" id="retryAiTriage" type="button">もう一度聞く</button></div>`;
    document.getElementById("manualTriageAfterAiError").addEventListener("click", () => renderTriageStart(item));
    document.getElementById("retryAiTriage").addEventListener("click", () => requestAiTriage(item, answers));
  }
}

function renderAiSuggestion(item, result) {
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  const questions = Array.isArray(result.questions) ? result.questions : [];
  if (suggestions.length === 0) {
    throw new Error("AI整理案を安全に読み取れませんでした。");
  }
  els.drawerKicker.textContent = triageKicker(item);
  els.drawerTitle.textContent = "AIからの整理案";
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel())}</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-summary"><span>読み取り</span><p>${escapeHtml(result.summary || "整理案を作成しました。")}</p></div>
    ${questions.length > 0 ? `<form class="ai-questions" id="aiClarificationForm">
      <strong>もう少し教えてください</strong>
      ${questions.map((question, index) => `<label class="form-field" for="aiAnswer${index}"><span>${escapeHtml(question)}</span><textarea id="aiAnswer${index}" name="answer" rows="2" maxlength="320" required></textarea></label>`).join("")}
      <button class="secondary-action" type="submit">回答をもとに再提案</button>
    </form>` : ""}
    <div class="ai-suggestions">
      ${suggestions.map((suggestion, index) => {
        const intent = routeIntentMeta[suggestion.intent];
        const destination = routeDestinationMeta[suggestion.destination];
        if (!intent || !destination) return "";
        return `<article class="ai-suggestion-card">
          <div><span>${escapeHtml(intent.label)} → ${escapeHtml(destination.label)}</span>${suggestion.cadence ? `<small>${escapeHtml(cadenceLabels[suggestion.cadence] || suggestion.cadence)}</small>` : ""}</div>
          <h3>${escapeHtml(suggestion.title)}</h3>
          ${suggestion.detail ? `<p>${escapeHtml(suggestion.detail)}</p>` : ""}
          <p class="ai-suggestion-reason">${escapeHtml(suggestion.reason)}</p>
          <button class="primary-action" type="button" data-ai-suggestion="${index}">この案を使う</button>
        </article>`;
      }).join("")}
    </div>
    <p class="ai-data-note">これは未保存の案です。「この案を使う」の後に内容を編集し、確認画面で確定します。</p>
    <div class="drawer-actions"><button class="secondary-action" id="manualTriageAfterAi" type="button">自分で選ぶ</button><button class="secondary-action" id="askAiAgain" type="button">最初から聞き直す</button></div>`;

  document.getElementById("aiClarificationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const answerFields = [...event.currentTarget.querySelectorAll('textarea[name="answer"]')];
    const answers = questions.map((question, index) => `質問${index + 1}: ${question}\n回答${index + 1}: ${answerFields[index].value.trim()}`).join("\n\n");
    requestAiTriage(item, answers);
  });
  els.drawerBody.querySelectorAll("[data-ai-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const suggestion = suggestions[Number(button.dataset.aiSuggestion)];
      if (suggestion) renderRouteForm(item, suggestion.intent, suggestion.destination, suggestion);
    });
  });
  document.getElementById("manualTriageAfterAi").addEventListener("click", () => renderTriageStart(item));
  document.getElementById("askAiAgain").addEventListener("click", () => requestAiTriage(item));
}

function renderDestinationStep(item, intent) {
  const intentMeta = routeIntentMeta[intent];
  if (!intentMeta) return renderTriageStart(item);
  els.drawerTitle.textContent = "振り分け先を選ぶ";
  const destinations = destinationsByIntent[intent] || [];
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(intentMeta.label)}</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="triage-options">
      ${destinations.map((destination) => {
        const meta = routeDestinationMeta[destination];
        return `<button class="triage-option" type="button" data-destination="${destination}"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.description)}</span></button>`;
      }).join("")}
    </div>
    <div class="drawer-actions"><button class="secondary-action" id="backToIntent" type="button">戻る</button></div>`;
  document.querySelectorAll("[data-destination]").forEach((button) => button.addEventListener("click", () => renderRouteForm(item, intent, button.dataset.destination)));
  document.getElementById("backToIntent").addEventListener("click", () => renderTriageStart(item));
}

function renderRouteForm(item, intent, destination, initial = {}, origin = initial.origin || "triage") {
  const destinationMeta = routeDestinationMeta[destination];
  if (!destinationMeta) return renderDestinationStep(item, intent);
  const title = initial.title ?? item.content.slice(0, 240);
  const detail = initial.detail ?? "";
  const cadence = initial.cadence ?? "daily";
  const calendar = initial.calendar ?? {
    allDay: true,
    date: "",
    startTime: "09:00",
    endTime: "09:30",
    timeZone: "Asia/Tokyo",
  };
  const detailLabel = ({
    calendar: "実行内容・希望日時",
    github: "背景・完了条件",
    writing: "問い・掘り下げたいこと",
    habit: "目的・続けたい理由",
    knowledge: "調べること・検証条件",
    focus: "意味・意識したい理由",
    journal: "残したい背景",
    archive: "見送る理由・補足",
  })[destination] || "補足";
  const routeBoundary = destination === "calendar"
    ? "確認画面の登録ボタンを押すと、Googleのメインカレンダーへ実際に予定を作成します。"
    : destinationMeta.internal ? "" : "この段階では外部へ送信せず、登録計画だけを保存します。";
  const calendarFields = destination === "calendar" ? `
    <div class="integration-status loading" id="calendarConnectionStatus" role="status">Google Calendarの接続状態を確認しています…</div>
    <label class="form-field" for="routeCalendarDate"><span>日付</span><input id="routeCalendarDate" name="calendarDate" type="date" value="${escapeHtml(calendar.date || "")}" required></label>
    <label class="calendar-all-day" for="routeCalendarAllDay"><input id="routeCalendarAllDay" name="calendarAllDay" type="checkbox" ${calendar.allDay ? "checked" : ""}><span>終日予定として登録</span></label>
    <div class="calendar-time-fields" id="calendarTimeFields" ${calendar.allDay ? "hidden" : ""}>
      <label class="form-field" for="routeCalendarStart"><span>開始</span><input id="routeCalendarStart" name="calendarStart" type="time" value="${escapeHtml(calendar.startTime || "09:00")}"></label>
      <label class="form-field" for="routeCalendarEnd"><span>終了</span><input id="routeCalendarEnd" name="calendarEnd" type="time" value="${escapeHtml(calendar.endTime || "09:30")}"></label>
    </div>
    <p class="calendar-time-zone">タイムゾーン: Asia/Tokyo</p>` : "";
  els.drawerTitle.textContent = destinationMeta.label;
  els.drawerBody.innerHTML = `<form class="edit-form" id="routeForm">
    <div class="source-context"><span>${escapeHtml(triageSourceLabel())}</span><p>${escapeHtml(item.content)}</p></div>
    ${routeBoundary ? `<p class="route-boundary">${escapeHtml(routeBoundary)}</p>` : ""}
    <label class="form-field" for="routeTitle"><span>タイトル</span><textarea id="routeTitle" name="title" rows="3" maxlength="240" required>${escapeHtml(title)}</textarea><small><b id="routeTitleCount">${title.length}</b> / 240</small></label>
    <label class="form-field" for="routeDetail"><span>${escapeHtml(detailLabel)} <small>空欄可</small></span><textarea id="routeDetail" name="detail" rows="6" maxlength="2000">${escapeHtml(detail)}</textarea><small><b id="routeDetailCount">${detail.length}</b> / 2000</small></label>
    ${calendarFields}
    ${destination === "habit" ? `<label class="form-field" for="routeCadence"><span>頻度</span><select id="routeCadence" name="cadence">${Object.entries(cadenceLabels).map(([value, label]) => `<option value="${value}" ${cadence === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>` : ""}
    <p class="form-error" id="routeFormError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="backToDestination" type="button">戻る</button><button class="primary-action" id="routeFormSubmit" type="submit" ${destination === "calendar" ? "disabled" : ""}>確認へ</button></div>
  </form>`;
  const form = document.getElementById("routeForm");
  const titleInput = document.getElementById("routeTitle");
  const detailInput = document.getElementById("routeDetail");
  const formSubmit = document.getElementById("routeFormSubmit");
  titleInput.addEventListener("input", () => { document.getElementById("routeTitleCount").textContent = titleInput.value.length; });
  detailInput.addEventListener("input", () => { document.getElementById("routeDetailCount").textContent = detailInput.value.length; });
  if (destination === "calendar") {
    const allDayInput = document.getElementById("routeCalendarAllDay");
    const timeFields = document.getElementById("calendarTimeFields");
    const updateTimeFields = () => {
      timeFields.hidden = allDayInput.checked;
      form.elements.calendarStart.required = !allDayInput.checked;
      form.elements.calendarEnd.required = !allDayInput.checked;
    };
    allDayInput.addEventListener("change", updateTimeFields);
    updateTimeFields();
    refreshGoogleCalendarConnection(document.getElementById("calendarConnectionStatus"), formSubmit);
  }
  document.getElementById("backToDestination").addEventListener("click", () => {
    if (origin === "quick") renderDrawerItem(item, state.triageSource);
    else renderDestinationStep(item, intent);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextTitle = form.elements.title.value.trim();
    if (!nextTitle) {
      const error = document.getElementById("routeFormError");
      error.textContent = "タイトルを入力してください。";
      error.hidden = false;
      form.elements.title.focus();
      return;
    }
    let nextCalendar = null;
    if (destination === "calendar") {
      const error = document.getElementById("routeFormError");
      if (!state.calendarConnection?.connected) {
        error.textContent = "Google Calendarを接続してから確認へ進んでください。";
        error.hidden = false;
        return;
      }
      const date = form.elements.calendarDate.value;
      const allDay = form.elements.calendarAllDay.checked;
      const startTime = allDay ? null : form.elements.calendarStart.value;
      const endTime = allDay ? null : form.elements.calendarEnd.value;
      if (!date) {
        error.textContent = "Google Calendarへ登録する日付を入力してください。";
        error.hidden = false;
        form.elements.calendarDate.focus();
        return;
      }
      if (!allDay && (!startTime || !endTime || endTime <= startTime)) {
        error.textContent = "終了時刻は開始時刻より後にしてください。";
        error.hidden = false;
        form.elements.calendarStart.focus();
        return;
      }
      nextCalendar = { allDay, date, startTime, endTime, timeZone: "Asia/Tokyo" };
    }
    renderRoutePreview(item, {
      intent,
      destination,
      title: nextTitle,
      detail: form.elements.detail.value.trim(),
      cadence: destination === "habit" ? form.elements.cadence.value : null,
      calendar: nextCalendar,
      idempotencyKey: crypto.randomUUID(),
      origin,
    });
  });
  titleInput.focus();
}

function renderRoutePreview(item, plan) {
  const intentMeta = routeIntentMeta[plan.intent];
  const destinationMeta = routeDestinationMeta[plan.destination];
  els.drawerTitle.textContent = "振り分け内容を確認";
  els.drawerBody.innerHTML = `<div class="route-preview">
      <div><span>${escapeHtml(triageSourceLabel())}</span><p>${escapeHtml(item.content)}</p></div>
      <div><span>扱い</span><strong>${escapeHtml(intentMeta.label)}</strong></div>
      <div><span>振り分け先</span><strong>${escapeHtml(destinationMeta.label)}</strong></div>
      <div><span>タイトル</span><p>${escapeHtml(plan.title)}</p></div>
      ${plan.detail ? `<div><span>補足</span><p>${escapeHtml(plan.detail)}</p></div>` : ""}
      ${plan.cadence ? `<div><span>頻度</span><strong>${escapeHtml(cadenceLabels[plan.cadence])}</strong></div>` : ""}
      ${plan.calendar ? `<div><span>予定日時</span><strong>${escapeHtml(formatCalendarSchedule(plan.calendar))}</strong><small>メインカレンダー · Asia/Tokyo</small></div>` : ""}
    </div>
    <p class="flow-note">${escapeHtml(plan.destination === "calendar" ? `登録するとGoogle Calendarへ予定を作成し、${triageCompletionNote()}` : destinationMeta.internal ? `確定するとPersonal Dashboard内の管理先へ登録し、${triageCompletionNote()}` : `確定すると振り分け計画を保存し、${triageCompletionNote()}外部システムへの送信は、接続方法の合意後に別途行います。`)}</p>
    <p class="form-error" id="routeSaveError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="editRoutePlan" type="button">修正する</button><button class="primary-action" id="confirmRoutePlan" type="button">${routeConfirmationLabel(plan.destination)}</button></div>`;
  document.getElementById("editRoutePlan").addEventListener("click", () => renderRouteForm(item, plan.intent, plan.destination, plan, plan.origin));
  document.getElementById("confirmRoutePlan").addEventListener("click", () => saveWantRoute(item, plan));
}

function routeConfirmationLabel(destination) {
  return destination === "calendar" ? "Google Calendarに登録して完了" : "振り分けて完了";
}

async function saveWantRoute(item, plan) {
  const submit = document.getElementById("confirmRoutePlan");
  const edit = document.getElementById("editRoutePlan");
  const errorElement = document.getElementById("routeSaveError");
  submit.disabled = true;
  edit.disabled = true;
  submit.textContent = plan.destination === "calendar" ? "Calendarへ登録中…" : "保存中…";
  errorElement.hidden = true;
  const fromInbox = state.triageSource === "inbox";
  try {
    if (fromInbox && state.inboxWant?.sourceId !== item.id) {
      state.inboxWant = { sourceId: item.id, want: await createWantFromSource(item) };
    }
    const target = fromInbox ? state.inboxWant.want : { id: item.id, content: item.content, status: item.status };
    const response = await fetch("/api/want-routes", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-route-create",
      },
      body: JSON.stringify({
        wantId: target.id,
        intent: plan.intent,
        destination: plan.destination,
        title: plan.title,
        detail: plan.detail || null,
        cadence: plan.cadence,
        calendar: plan.calendar || null,
        idempotencyKey: plan.idempotencyKey,
        original: { content: target.content, status: target.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "振り分けを保存できませんでした。");

    let inboxWarning = "";
    if (fromInbox) {
      state.inboxWant = null;
      try {
        await markInboxTriaged(item, `${routeDestinationMeta[plan.destination]?.label || plan.destination}へ振り分け`);
      } catch {
        inboxWarning = "振り分けは完了しましたが、元のInboxを整理済みにできませんでした。Inboxを再読込して確認してください。";
      }
    }

    const refreshed = await loadDashboard();
    if (!refreshed) {
      errorElement.textContent = "振り分けは保存しましたが、最新状態を再読み込みできませんでした。再読込してください。";
      errorElement.hidden = false;
      return;
    }
    const closedLabel = fromInbox ? "Inboxを整理済みにしました" : "Wantを完了しました";
    showToast(inboxWarning || (plan.destination === "calendar" && payload.status === "created"
      ? `Google Calendarへ予定を登録し、${closedLabel}。`
      : payload.status === "created" ? `振り分け先へ登録し、${closedLabel}。` : `振り分け計画を保存し、${closedLabel}。外部への登録はまだ行っていません。`));
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : "振り分けを保存できませんでした。";
    errorElement.hidden = false;
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      edit.disabled = false;
      submit.textContent = routeConfirmationLabel(plan.destination);
    }
  }
}

function renderKnowledgeCompletion(item, route) {
  els.drawerTitle.textContent = "Knowledge登録済みにする";
  els.drawerBody.innerHTML = `<div class="route-preview">
      <div><span>Want</span><p>${escapeHtml(item.content)}</p></div>
      <div><span>Knowledge候補</span><p>${escapeHtml(route.title)}</p></div>
    </div>
    <p class="flow-note">ナレッジDBへ登録済みの候補だけを登録済みにします。この操作はナレッジDBへ書き込まず、登録待ちの表示を解除するだけです。</p>
    <form class="edit-form" id="knowledgeCompleteForm">
      <label class="form-field" for="knowledgeIdInput">
        <span>Knowledge ID <small>空欄可</small></span>
        <input id="knowledgeIdInput" name="knowledgeId" type="text" maxlength="36" autocomplete="off" spellcheck="false" placeholder="ナレッジDBのUUID">
        <small>入力すると振り分け履歴から正本のナレッジを開けます。</small>
      </label>
      <p class="form-error" id="knowledgeCompleteError" role="alert" hidden></p>
      <div class="drawer-actions">
        <button class="secondary-action" id="cancelKnowledgeComplete" type="button">戻る</button>
        <button class="primary-action" id="confirmKnowledgeComplete" type="submit">登録済みにする</button>
      </div>
    </form>`;
  document.getElementById("cancelKnowledgeComplete").addEventListener("click", () => renderDrawerItem(item, "wants"));
  document.getElementById("knowledgeCompleteForm")
    .addEventListener("submit", (event) => saveKnowledgeCompletion(event, item, route));
}

async function saveKnowledgeCompletion(event, item, route) {
  event.preventDefault();
  const submit = document.getElementById("confirmKnowledgeComplete");
  const errorElement = document.getElementById("knowledgeCompleteError");
  const knowledgeId = document.getElementById("knowledgeIdInput").value.trim();
  submit.disabled = true;
  submit.textContent = "更新中…";
  errorElement.hidden = true;
  try {
    const response = await fetch("/api/want-routes", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-route-complete",
      },
      body: JSON.stringify({
        routeId: route.id,
        knowledgeId: knowledgeId || null,
        original: { destination: route.destination, status: route.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "Knowledge登録済みにできませんでした。");

    const refreshed = await loadDashboard();
    if (!refreshed) {
      closeDrawer();
      showToast("Knowledge登録済みにしました。最新状態は再読込して確認してください。");
      return;
    }
    const updated = (state.data?.wants || []).find((entry) => entry.id === item.id);
    if (updated) renderDrawerItem(updated, "wants");
    else closeDrawer();
    showToast("Knowledge登録済みにしました。登録待ちから外れます。");
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : "Knowledge登録済みにできませんでした。";
    errorElement.hidden = false;
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = "登録済みにする";
    }
  }
}

function setCloseItemError(message) {
  const error = document.getElementById("closeItemError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function closeItem(item, view) {
  const meta = closeMeta[view];
  const button = document.getElementById("closeItemButton");
  if (!meta || !button || !canCloseItem(item, view)) return;
  if (!window.confirm(meta.confirm)) return;

  button.disabled = true;
  button.textContent = "クローズ中…";
  setCloseItemError("");

  const body = view === "inbox"
    ? {
        id: item.id,
        content: item.content,
        status: meta.closedStatus,
        result: item.result,
        original: { content: item.content, status: item.status, result: item.result },
      }
    : {
        id: item.id,
        content: item.content,
        status: meta.closedStatus,
        original: { content: item.content, status: item.status },
      };

  try {
    const response = await fetch(meta.endpoint, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": meta.actionHeader,
      },
      body: JSON.stringify(body),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || `${meta.button}に失敗しました。`);

    closeDrawer();
    const refreshed = await loadDashboard();
    showToast(refreshed ? meta.success : `${meta.success} 最新状態は再読込して確認してください。`);
  } catch (error) {
    setCloseItemError(error instanceof Error ? error.message : `${meta.button}に失敗しました。`);
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = meta.button;
    }
  }
}

function renderInboxEditForm(item) {
  const statuses = ["pending", "done", "skipped"];
  const currentOption = statuses.includes(item.status)
    ? ""
    : `<option value="${escapeHtml(item.status)}" selected disabled>${escapeHtml(statusLabel(item.status))}</option>`;
  const statusOptions = statuses.map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("");
  els.drawerTitle.textContent = "Inboxを編集";
  els.drawerBody.innerHTML = `<form class="edit-form" id="inboxEditForm">
    <label class="form-field" for="editInboxContent">
      <span>内容</span>
      <textarea id="editInboxContent" name="content" rows="7" maxlength="2000" required>${escapeHtml(item.content)}</textarea>
      <small><b id="editContentCount">${item.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="editInboxStatus">
      <span>ステータス</span>
      <select id="editInboxStatus" name="status">${currentOption}${statusOptions}</select>
    </label>
    <label class="form-field" for="editInboxResult">
      <span>整理結果 <small>空欄可</small></span>
      <textarea id="editInboxResult" name="result" rows="5" maxlength="2000">${escapeHtml(item.result || "")}</textarea>
      <small><b id="editResultCount">${(item.result || "").length}</b> / 2000</small>
    </label>
    <p class="form-error" id="inboxEditError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelInboxEdit" type="button">キャンセル</button>
      <button class="primary-action" id="saveInboxEdit" type="submit">変更を保存</button>
    </div>
  </form>`;

  const form = document.getElementById("inboxEditForm");
  const content = document.getElementById("editInboxContent");
  const result = document.getElementById("editInboxResult");
  content.addEventListener("input", () => { document.getElementById("editContentCount").textContent = content.value.length; });
  result.addEventListener("input", () => { document.getElementById("editResultCount").textContent = result.value.length; });
  document.getElementById("cancelInboxEdit").addEventListener("click", () => renderDrawerItem(item, "inbox"));
  form.addEventListener("submit", (event) => saveInbox(event, item));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setInboxEditError(message) {
  const error = document.getElementById("inboxEditError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveInbox(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  if (!content) {
    setInboxEditError("Inboxの内容を入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveInboxEdit");
  const cancel = document.getElementById("cancelInboxEdit");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setInboxEditError("");

  try {
    const response = await fetch("/api/inbox", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "inbox-update",
      },
      body: JSON.stringify({
        id: item.id,
        content,
        status: form.elements.status.value,
        result: form.elements.result.value,
        original: { content: item.content, status: item.status, result: item.result },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "Inboxを更新できませんでした。");

    const refreshed = await loadDashboard();
    if (!refreshed) {
      setInboxEditError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast("Inboxを更新しました。");
  } catch (error) {
    setInboxEditError(error instanceof Error ? error.message : "Inboxを更新できませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "変更を保存";
    }
  }
}

function renderItemEditForm(item, view) {
  const meta = itemEditMeta[view];
  if (!meta) return;
  const currentOption = meta.statuses.includes(item.status)
    ? ""
    : `<option value="${escapeHtml(item.status)}" selected disabled>${escapeHtml(statusLabel(item.status))}</option>`;
  const statusOptions = meta.statuses.map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("");
  els.drawerTitle.textContent = meta.title;
  els.drawerBody.innerHTML = `<form class="edit-form" id="itemEditForm">
    <label class="form-field" for="editItemContent">
      <span>内容</span>
      <textarea id="editItemContent" name="content" rows="7" maxlength="2000" required>${escapeHtml(item.content)}</textarea>
      <small><b id="editItemContentCount">${item.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="editItemStatus">
      <span>ステータス</span>
      <select id="editItemStatus" name="status">${currentOption}${statusOptions}</select>
    </label>
    <p class="form-error" id="itemEditError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelItemEdit" type="button">キャンセル</button>
      <button class="primary-action" id="saveItemEdit" type="submit">変更を保存</button>
    </div>
  </form>`;

  const form = document.getElementById("itemEditForm");
  const content = document.getElementById("editItemContent");
  content.addEventListener("input", () => { document.getElementById("editItemContentCount").textContent = content.value.length; });
  document.getElementById("cancelItemEdit").addEventListener("click", () => renderDrawerItem(item, view));
  form.addEventListener("submit", (event) => saveItem(event, item, view));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setItemEditError(message) {
  const error = document.getElementById("itemEditError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveItem(event, item, view) {
  event.preventDefault();
  const form = event.currentTarget;
  const meta = itemEditMeta[view];
  const content = form.elements.content.value.trim();
  if (!content) {
    setItemEditError("内容を入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveItemEdit");
  const cancel = document.getElementById("cancelItemEdit");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setItemEditError("");

  try {
    const response = await fetch(meta.endpoint, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": meta.actionHeader,
      },
      body: JSON.stringify({
        id: item.id,
        content,
        status: form.elements.status.value,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || `${meta.title}を保存できませんでした。`);

    const refreshed = await loadDashboard();
    if (!refreshed) {
      setItemEditError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast(meta.success);
  } catch (error) {
    setItemEditError(error instanceof Error ? error.message : `${meta.title}を保存できませんでした。`);
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "変更を保存";
    }
  }
}

async function createWantFromSource(sourceItem, extra = {}) {
  const response = await fetch("/api/wants", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "want-create",
    },
    body: JSON.stringify({ content: sourceItem.content, sourceInboxId: sourceItem.id, ...extra }),
  });
  const payload = await readApiJson(response);
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "Wantを作成できませんでした。");
  if (!Number.isSafeInteger(Number(payload.id))) throw new Error("保存結果を確認できませんでした。");
  return {
    id: Number(payload.id),
    content: typeof payload.content === "string" ? payload.content : sourceItem.content,
    status: "active",
  };
}

async function markInboxTriaged(sourceItem, result) {
  const response = await fetch("/api/inbox", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-update",
    },
    body: JSON.stringify({
      id: sourceItem.id,
      content: sourceItem.content,
      status: "done",
      result,
      original: {
        content: sourceItem.content,
        status: sourceItem.status,
        result: sourceItem.result ?? null,
      },
    }),
  });
  const payload = await readApiJson(response);
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "元のInboxを整理済みにできませんでした。");
}

function renderWishForm(sourceItem) {
  els.drawerKicker.textContent = triageKicker(sourceItem, "inbox");
  els.drawerTitle.textContent = "欲しい";
  els.drawerBody.innerHTML = `<form class="edit-form" id="wishForm">
    <div class="source-context"><span>元のInbox</span><p>${escapeHtml(sourceItem.content)}</p></div>
    <p class="route-boundary">購入予定にはせず、欲しいものとしてWantsに残します。必要になったら予定・調査・見送りへ振り分けられます。</p>
    <label class="form-field" for="wishContent">
      <span>欲しいもの</span>
      <textarea id="wishContent" name="content" rows="6" maxlength="2000" required>${escapeHtml(sourceItem.content)}</textarea>
      <small><b id="wishContentCount">${sourceItem.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="wishNote">
      <span>メモ <small>空欄可</small></span>
      <textarea id="wishNote" name="note" rows="4" maxlength="2000" placeholder="欲しい理由、条件、候補など"></textarea>
    </label>
    <p class="form-error" id="wishError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelWish" type="button">戻る</button>
      <button class="primary-action" id="saveWishButton" type="submit">欲しいものとして保存</button>
    </div>
  </form>`;

  const form = document.getElementById("wishForm");
  const content = document.getElementById("wishContent");
  content.addEventListener("input", () => { document.getElementById("wishContentCount").textContent = content.value.length; });
  document.getElementById("cancelWish").addEventListener("click", () => renderDrawerItem(sourceItem, "inbox"));
  form.addEventListener("submit", (event) => saveWish(event, sourceItem));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setWishError(message) {
  const error = document.getElementById("wishError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveWish(event, sourceItem) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  const note = form.elements.note.value.trim();
  if (!content) {
    setWishError("欲しいものを入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveWishButton");
  const cancel = document.getElementById("cancelWish");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setWishError("");

  try {
    await createWantFromSource({ ...sourceItem, content }, { type: "wish", note: note || null });
    let inboxWarning = "";
    try {
      await markInboxTriaged(sourceItem, "欲しいものとしてWantsに保存");
    } catch {
      inboxWarning = "Wantsへ保存しましたが、元のInboxを整理済みにできませんでした。Inboxを再読込して確認してください。";
    }
    const refreshed = await loadDashboard();
    if (!refreshed) {
      setWishError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast(inboxWarning || "欲しいものとしてWantsに保存し、Inboxを整理済みにしました。");
  } catch (error) {
    setWishError(error instanceof Error ? error.message : "欲しいものとして保存できませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "欲しいものとして保存";
    }
  }
}

function renderDeferForm(sourceItem) {
  const revisitOn = defaultRevisitDate();
  els.drawerKicker.textContent = triageKicker(sourceItem, "inbox");
  els.drawerTitle.textContent = "寝かせる";
  els.drawerBody.innerHTML = `<form class="edit-form" id="deferForm">
    <div class="source-context"><span>元のInbox</span><p>${escapeHtml(sourceItem.content)}</p></div>
    <p class="route-boundary">振り分け先は決めず、次に考える日だけ決めてWantsへ置きます。再訪日が来ると未整理のWantsとして浮上します。</p>
    <label class="form-field" for="deferContent">
      <span>内容</span>
      <textarea id="deferContent" name="content" rows="6" maxlength="2000" required>${escapeHtml(sourceItem.content)}</textarea>
      <small><b id="deferContentCount">${sourceItem.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="deferRevisitOn">
      <span>再訪日</span>
      <input id="deferRevisitOn" name="revisitOn" type="date" value="${escapeHtml(revisitOn)}" min="${escapeHtml(todayInTokyo())}" required>
      <small>既定は1ヶ月後です。</small>
    </label>
    <label class="form-field" for="deferNote">
      <span>メモ <small>空欄可</small></span>
      <textarea id="deferNote" name="note" rows="4" maxlength="2000" placeholder="今は動かさない理由、再訪時に思い出したいこと"></textarea>
    </label>
    <p class="form-error" id="deferError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelDefer" type="button">戻る</button>
      <button class="primary-action" id="saveDeferButton" type="submit">寝かせる</button>
    </div>
  </form>`;

  const form = document.getElementById("deferForm");
  const content = document.getElementById("deferContent");
  content.addEventListener("input", () => { document.getElementById("deferContentCount").textContent = content.value.length; });
  document.getElementById("cancelDefer").addEventListener("click", () => renderDrawerItem(sourceItem, "inbox"));
  form.addEventListener("submit", (event) => saveDefer(event, sourceItem));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setDeferError(message) {
  const error = document.getElementById("deferError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveDefer(event, sourceItem) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  const revisitOn = form.elements.revisitOn.value;
  const note = form.elements.note.value.trim();
  if (!content) {
    setDeferError("内容を入力してください。");
    form.elements.content.focus();
    return;
  }
  if (!revisitOn) {
    setDeferError("再訪日を入力してください。");
    form.elements.revisitOn.focus();
    return;
  }
  if (revisitOn < todayInTokyo()) {
    setDeferError("再訪日は今日以降の日付を指定してください。");
    form.elements.revisitOn.focus();
    return;
  }

  const submit = document.getElementById("saveDeferButton");
  const cancel = document.getElementById("cancelDefer");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setDeferError("");

  try {
    await createWantFromSource({ ...sourceItem, content }, { revisitOn, note: note || null });
    let inboxWarning = "";
    try {
      await markInboxTriaged(sourceItem, `寝かせる（再訪 ${revisitOn}）`);
    } catch {
      inboxWarning = "Wantsへ置きましたが、元のInboxを整理済みにできませんでした。Inboxを再読込して確認してください。";
    }
    const refreshed = await loadDashboard();
    if (!refreshed) {
      setDeferError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast(inboxWarning || `${revisitOn}に再訪するWantとして寝かせ、Inboxを整理済みにしました。`);
  } catch (error) {
    setDeferError(error instanceof Error ? error.message : "寝かせることができませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "寝かせる";
    }
  }
}

function syncCompassRoute(view, id = null, mode = "replace", filter = null) {
  const path = compassRoutePath(window.location.href, view, id, filter);
  const historyState = id === null ? null : { compassDrawer: true };
  if (mode === "push") window.history.pushState(historyState, "", path);
  else window.history.replaceState(historyState, "", path);
}

function hideDrawer() {
  state.aiRequestToken += 1;
  state.drawerItem = null;
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
  document.body.style.overflow = "";
}

function openDrawer(id, view = state.view, historyMode = "push") {
  const item = (state.data?.[view] || []).find((entry) => entry.id === id);
  if (!item) return false;
  state.aiRequestToken += 1;
  state.drawerItem = { id, view };
  renderDrawerItem(item, view);
  els.drawerBackdrop.hidden = false;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els.drawerClose.focus();
  if (historyMode !== "none") syncCompassRoute(view, id, historyMode);
  return true;
}

function closeDrawer(sync = true) {
  const route = parseCompassRoute(window.location.href);
  if (sync && route.id !== null && window.history.state?.compassDrawer) {
    window.history.back();
    return;
  }
  hideDrawer();
  if (sync) syncCompassRoute(state.view, null, "replace", state.metricFilter);
}

function setModalOpen(open) {
  els.inboxModal.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
  if (!open && new URLSearchParams(window.location.search).get("new") === "inbox") {
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  }
  if (open) {
    els.inboxFormError.hidden = true;
    window.setTimeout(() => els.inboxContent.focus(), 0);
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 3500);
}

async function createInbox(event) {
  event.preventDefault();
  const content = els.inboxContent.value.trim();
  if (!content) {
    els.inboxFormError.textContent = "Inboxの内容を入力してください。";
    els.inboxFormError.hidden = false;
    return;
  }
  els.inboxSubmitButton.disabled = true;
  els.inboxFormError.hidden = true;
  try {
    const response = await fetch("/api/inbox", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "inbox-create",
      },
      body: JSON.stringify({ content }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "Inboxを保存できませんでした。");
    els.inboxForm.reset();
    els.inboxCharacterCount.textContent = "0";
    setModalOpen(false);
    state.view = "inbox";
    state.status = defaultStatusByView.inbox;
    state.metricFilter = "";
    syncCompassRoute("inbox");
    showToast("Inboxに保存しました。リストへ反映しています。");
    await loadDashboard();
  } catch (error) {
    els.inboxFormError.textContent = error instanceof Error ? error.message : "Inboxを保存できませんでした。";
    els.inboxFormError.hidden = false;
  } finally {
    els.inboxSubmitButton.disabled = false;
  }
}

function setView(view, filter = defaultStatusByView[view], sync = true) {
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

function applyCompassRoute(notify = true) {
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

async function loadTodos(render = state.view === "todos") {
  if (!state.data) return false;
  if (render) els.cardList.innerHTML = '<div class="loading"><span></span><p>Google CalendarとToDoを同期しています</p></div>';
  try {
    const response = await fetch("/api/scheduled-actions", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error?.message || payload.error || "ToDoを読み込めませんでした。");
    state.data.todos = Array.isArray(payload.items) ? payload.items : [];
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

async function loadDashboard() {
  els.refreshButton.disabled = true;
  els.cardList.innerHTML = '<div class="loading"><span></span><p>Supabaseから読み込んでいます</p></div>';
  try {
    const response = await fetch("/api/dashboard", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error?.message || "データを読み込めませんでした。");
    payload.todos = state.data?.todos || [];
    payload.todosSummary = state.data?.todosSummary || null;
    state.data = payload;
    setSource(payload.source);
    renderSummary();
    renderNavigation(payload.navigation || []);
    const requestedRoute = parseCompassRoute(window.location.href);
    if (requestedRoute.view === "todos") await loadTodos(false);
    applyCompassRoute();
    if (state.view !== "todos") void loadTodos(false);
    return true;
  } catch (error) {
    setSource(null, true);
    els.resultCount.textContent = "読み込みに失敗しました";
    els.cardList.innerHTML = `<div class="error-state"><h3>データを表示できません</h3><p>${escapeHtml(error.message)}</p><button type="button" id="retryButton">再試行</button></div>`;
    document.getElementById("retryButton").addEventListener("click", loadDashboard);
    return false;
  } finally {
    els.refreshButton.disabled = false;
  }
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; clearBulkSelection(); renderList(); });
els.statusFilter.addEventListener("change", () => {
  state.status = els.statusFilter.value; state.metricFilter = ""; clearBulkSelection(); renderList();
  syncCompassRoute(state.view);
});
els.clearFilter.addEventListener("click", () => {
  state.status = ""; state.search = ""; state.metricFilter = "";
  els.searchInput.value = ""; clearBulkSelection(); updateStatusOptions(); renderList(); syncCompassRoute(state.view);
});
els.bulkModeButton.addEventListener("click", () => setBulkMode(true));
els.bulkCancelButton.addEventListener("click", () => setBulkMode(false));
els.bulkSelectAll.addEventListener("change", () => {
  const visibleIds = currentItems().map((item) => item.id).filter((id) => Number.isSafeInteger(id));
  visibleIds.forEach((id) => {
    if (els.bulkSelectAll.checked) state.bulkSelected.add(id);
    else state.bulkSelected.delete(id);
  });
  state.bulkError = "";
  renderList();
});
els.bulkApplyButton.addEventListener("click", applyInboxBulkUpdate);
els.knowledgeFilter.addEventListener("click", () => {
  setView("wants", state.view === "wants" && state.metricFilter === "knowledge" ? defaultStatusByView.wants : "knowledge");
});
els.githubFilter.addEventListener("click", () => {
  setView("wants", state.view === "wants" && state.metricFilter === "github" ? defaultStatusByView.wants : "github");
});
els.todoFilterGroup.querySelectorAll("[data-todo-filter]").forEach((button) => button.addEventListener("click", () => {
  const filter = button.dataset.todoFilter;
  setView("todos", state.metricFilter === filter ? defaultStatusByView.todos : filter);
}));
els.refreshButton.addEventListener("click", loadDashboard);
els.addInboxButton.addEventListener("click", () => setModalOpen(true));
els.inboxModalClose.addEventListener("click", () => setModalOpen(false));
els.inboxCancelButton.addEventListener("click", () => setModalOpen(false));
els.inboxModal.addEventListener("click", (event) => { if (event.target === els.inboxModal) setModalOpen(false); });
els.inboxForm.addEventListener("submit", createInbox);
els.inboxContent.addEventListener("input", () => { els.inboxCharacterCount.textContent = String(els.inboxContent.value.length); });
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.inboxModal.hidden) setModalOpen(false);
  else if (els.drawer.classList.contains("open")) closeDrawer();
});
document.addEventListener("click", (event) => {
  if (!els.dashboardSwitcher.contains(event.target)) els.dashboardSwitcher.removeAttribute("open");
});
window.addEventListener("popstate", () => applyCompassRoute());

const initialParameters = new URLSearchParams(window.location.search);
loadDashboard().then(() => {
  const calendarResult = initialParameters.get("calendar");
  if (calendarResult === "connected") showToast("Google Calendarを接続しました。");
  if (calendarResult === "denied") showToast("Google Calendarの接続はキャンセルされました。");
  if (calendarResult === "error") showToast("Google Calendarを接続できませんでした。設定を確認してください。");
  if (calendarResult) {
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("calendar");
    window.history.replaceState(null, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  }
});
if (initialParameters.get("new") === "inbox") setModalOpen(true);
