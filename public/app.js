const state = {
  data: null,
  view: "inbox",
  status: "",
  search: "",
  metricFilter: "",
};

const els = Object.fromEntries([
  "sourceBadge", "refreshButton",
  "pendingInbox", "inboxTotal", "activeWants", "wantsWithoutAction", "openActions",
  "inboxTabCount", "wantsTabCount", "actionsTabCount", "listTitle", "searchInput",
  "statusFilter", "resultCount", "clearFilter", "cardList", "drawerBackdrop",
  "drawer", "drawerClose", "drawerKicker", "drawerTitle", "drawerBody", "dashboardSwitcher", "dashboardNav",
  "addInboxButton", "inboxModal", "inboxModalClose", "inboxCancelButton", "inboxForm",
  "inboxContent", "inboxCharacterCount", "inboxFormError", "inboxSubmitButton", "toast",
].map((id) => [id, document.getElementById(id)]));

const viewMeta = {
  inbox: { title: "Inbox", singular: "Inbox", empty: "Inboxはすべて整理されています" },
  wants: { title: "Wants", singular: "Want", empty: "Wantsはまだありません" },
  actions: { title: "Next Actions", singular: "Action", empty: "次のアクションはまだありません" },
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
  if (state.metricFilter === "no-action") items = items.filter((item) => item.nextActions?.length === 0);
  if (state.metricFilter === "open") items = items.filter((item) => !["done", "completed", "closed"].includes(item.status));
  const needle = state.search.trim().toLocaleLowerCase("ja");
  if (needle) {
    items = items.filter((item) => [item.content, item.result, ...(item.nextActions || []).map((action) => action.content)]
      .filter(Boolean).some((value) => value.toLocaleLowerCase("ja").includes(needle)));
  }
  return items;
}

function updateStatusOptions() {
  const items = state.data?.[state.view] || [];
  const statuses = [...new Set(items.map((item) => item.status))].sort();
  els.statusFilter.innerHTML = '<option value="">すべてのステータス</option>'
    + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("");
  els.statusFilter.value = state.status;
}

function renderSummary() {
  const { summary, inbox, wants, actions } = state.data;
  els.pendingInbox.textContent = summary.pendingInbox;
  els.inboxTotal.textContent = summary.inboxTotal;
  els.activeWants.textContent = summary.activeWants;
  els.wantsWithoutAction.textContent = summary.wantsWithoutAction;
  els.openActions.textContent = summary.openActions;
  els.inboxTabCount.textContent = inbox.length;
  els.wantsTabCount.textContent = wants.length;
  els.actionsTabCount.textContent = actions.length;
}

function renderNavigation(items) {
  els.dashboardNav.innerHTML = items.map((item) => {
    const label = escapeHtml(item.label);
    if (item.current) return `<span class="current">${label}<small>CURRENT</small></span>`;
    if (!item.url) return `<span class="unavailable">${label}<small>SOON</small></span>`;
    return `<a href="${escapeHtml(item.url)}">${label}<small>OPEN</small></a>`;
  }).join("");
}

function statusLabel(status) {
  return ({ pending: "未整理", done: "整理済み", active: "進行中", open: "未完了", completed: "完了", closed: "完了" })[status] || status;
}

function cardMarkup(item) {
  const actionInfo = state.view === "wants"
    ? `<span class="action-count ${item.nextActions.length ? "" : "missing"}">${item.nextActions.length ? `次の行動 ${item.nextActions.length}件` : "次の行動なし"}</span>`
    : "";
  return `<button class="item-card" type="button" data-id="${item.id}">
    <div class="item-top"><span class="item-id">${viewMeta[state.view].singular.toUpperCase()} · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
    <h3>${escapeHtml(item.content || "内容なし")}</h3>
    <div class="item-footer"><span>${formatDate(item.createdAt)}</span>${actionInfo}</div>
  </button>`;
}

function renderList() {
  const items = currentItems();
  els.listTitle.textContent = viewMeta[state.view].title;
  els.resultCount.textContent = `${items.length}件を表示`;
  els.clearFilter.hidden = !(state.status || state.search || state.metricFilter);
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (!items.length) {
    els.cardList.innerHTML = `<div class="empty-state"><span>◇</span><h3>${escapeHtml(viewMeta[state.view].empty)}</h3><p>検索条件やステータスを変えて確認できます。</p></div>`;
    return;
  }
  els.cardList.innerHTML = items.map(cardMarkup).join("");
  els.cardList.querySelectorAll(".item-card").forEach((card) => card.addEventListener("click", () => openDrawer(Number(card.dataset.id))));
}

function openDrawer(id) {
  const item = (state.data?.[state.view] || []).find((entry) => entry.id === id);
  if (!item) return;
  els.drawerKicker.textContent = `${viewMeta[state.view].singular} · ${item.id}`;
  els.drawerTitle.textContent = item.content || "内容なし";
  let body = `<div class="detail-grid">
    <div class="detail-box"><span>Status</span><strong>${escapeHtml(statusLabel(item.status))}</strong></div>
    <div class="detail-box"><span>Created</span><strong>${escapeHtml(formatDate(item.createdAt, true))}</strong></div>
  </div>`;
  if (state.view === "inbox") {
    body += `<div class="detail-section"><span>整理結果</span><p>${escapeHtml(item.result || "まだ整理されていません")}</p></div>`;
  }
  if (state.view === "wants") {
    body += `<div class="detail-section"><span>Next Actions</span>${item.nextActions.length
      ? `<div class="next-action-list">${item.nextActions.map((action) => `<div class="next-action"><b>${escapeHtml(action.content)}</b><small>${escapeHtml(statusLabel(action.status))}</small></div>`).join("")}</div>`
      : '<p>次のアクションはまだ登録されていません。</p>'}</div>`;
  }
  els.drawerBody.innerHTML = body;
  els.drawerBackdrop.hidden = false;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els.drawerClose.focus();
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
  document.body.style.overflow = "";
}

function setModalOpen(open) {
  els.inboxModal.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
  if (!open && new URLSearchParams(window.location.search).get("new") === "inbox") {
    window.history.replaceState(null, "", window.location.pathname);
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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Inboxを保存できませんでした。");
    els.inboxForm.reset();
    els.inboxCharacterCount.textContent = "0";
    setModalOpen(false);
    state.view = "inbox";
    state.status = "";
    state.metricFilter = "";
    showToast("Inboxに保存しました。リストへ反映しています。");
    await loadDashboard();
  } catch (error) {
    els.inboxFormError.textContent = error instanceof Error ? error.message : "Inboxを保存できませんでした。";
    els.inboxFormError.hidden = false;
  } finally {
    els.inboxSubmitButton.disabled = false;
  }
}

function setView(view, filter = "") {
  state.view = view;
  state.metricFilter = filter;
  state.status = filter === "pending" || filter === "active" ? filter : "";
  updateStatusOptions();
  renderList();
}

async function loadDashboard() {
  els.refreshButton.disabled = true;
  els.cardList.innerHTML = '<div class="loading"><span></span><p>Supabaseから読み込んでいます</p></div>';
  try {
    const response = await fetch("/api/dashboard", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "データを読み込めませんでした。");
    state.data = payload;
    setSource(payload.source);
    renderSummary();
    renderNavigation(payload.navigation || []);
    updateStatusOptions();
    renderList();
  } catch (error) {
    setSource(null, true);
    els.resultCount.textContent = "読み込みに失敗しました";
    els.cardList.innerHTML = `<div class="error-state"><h3>データを表示できません</h3><p>${escapeHtml(error.message)}</p><button type="button" id="retryButton">再試行</button></div>`;
    document.getElementById("retryButton").addEventListener("click", loadDashboard);
  } finally {
    els.refreshButton.disabled = false;
  }
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
document.querySelectorAll(".metric").forEach((metric) => metric.addEventListener("click", () => setView(metric.dataset.view, metric.dataset.filter)));
els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; renderList(); });
els.statusFilter.addEventListener("change", () => { state.status = els.statusFilter.value; state.metricFilter = ""; renderList(); });
els.clearFilter.addEventListener("click", () => {
  state.status = ""; state.search = ""; state.metricFilter = "";
  els.searchInput.value = ""; updateStatusOptions(); renderList();
});
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

loadDashboard();
if (new URLSearchParams(window.location.search).get("new") === "inbox") setModalOpen(true);
