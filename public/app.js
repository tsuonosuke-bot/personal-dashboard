const state = {
  data: null,
  view: "inbox",
  status: "pending",
  search: "",
  metricFilter: "",
  drawerItem: null,
};

const els = Object.fromEntries([
  "sourceBadge", "refreshButton",
  "pendingInbox", "inboxTotal", "activeWants",
  "inboxTabCount", "wantsTabCount", "listTitle", "searchInput",
  "statusFilter", "resultCount", "clearFilter", "cardList", "drawerBackdrop",
  "drawer", "drawerClose", "drawerKicker", "drawerTitle", "drawerBody", "dashboardSwitcher", "dashboardNav",
  "addInboxButton", "inboxModal", "inboxModalClose", "inboxCancelButton", "inboxForm",
  "inboxContent", "inboxCharacterCount", "inboxFormError", "inboxSubmitButton", "toast",
].map((id) => [id, document.getElementById(id)]));

const viewMeta = {
  inbox: { title: "Inbox", singular: "Inbox", empty: "Inboxはすべて整理されています" },
  wants: { title: "Wants", singular: "Want", empty: "Wantsはまだありません" },
};

const defaultStatusByView = {
  inbox: "pending",
  wants: "active",
};

const closedStatusesByView = {
  inbox: new Set(["done", "skipped", "completed", "closed", "cancelled", "archived"]),
  wants: new Set(["completed", "dropped", "done", "closed", "cancelled", "archived"]),
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

const createFlowMeta = {
  inbox: {
    title: "Wantとして追加",
    targetView: "wants",
    endpoint: "/api/wants",
    actionHeader: "want-create",
    submit: "Wantに追加",
    sourceLabel: "元のInbox",
    note: "Want追加後、元のInboxを処理済みにし、処理結果を「Wantsに登録」と記録します。",
    success: "Wantを追加し、Inboxを処理済みにしました。",
  },
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
  const needle = state.search.trim().toLocaleLowerCase("ja");
  if (needle) {
    items = items.filter((item) => [item.content, item.result, item.note]
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
  const { summary } = state.data;
  els.pendingInbox.textContent = summary.pendingInbox;
  els.inboxTotal.textContent = summary.inboxTotal;
  els.activeWants.textContent = summary.activeWants;
}

function renderCurrentTabCount(items) {
  els.inboxTabCount.textContent = state.data.inbox.filter((item) => item.status === defaultStatusByView.inbox).length;
  els.wantsTabCount.textContent = state.data.wants.filter((item) => item.status === defaultStatusByView.wants).length;
  const countElement = {
    inbox: els.inboxTabCount,
    wants: els.wantsTabCount,
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

function statusLabel(status) {
  return ({ pending: "未整理", done: "整理済み", skipped: "対象外", active: "進行中", completed: "完了", dropped: "見送り", closed: "完了" })[status] || status;
}

function canCloseItem(item, view) {
  return !closedStatusesByView[view]?.has(item.status);
}

function cardMarkup(item) {
  return `<button class="item-card" type="button" data-id="${item.id}">
    <div class="item-top"><span class="item-id">${viewMeta[state.view].singular.toUpperCase()} · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
    <h3>${escapeHtml(item.content || "内容なし")}</h3>
    <div class="item-footer"><span>${formatDate(item.createdAt)}</span></div>
  </button>`;
}

function renderList() {
  const items = currentItems();
  renderCurrentTabCount(items);
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

function renderDrawerItem(item, view) {
  els.drawerKicker.textContent = `${viewMeta[view].singular} · ${item.id}`;
  els.drawerTitle.textContent = item.content || "内容なし";
  let body = `<div class="detail-grid">
    <div class="detail-box"><span>Status</span><strong>${escapeHtml(statusLabel(item.status))}</strong></div>
    <div class="detail-box"><span>Created</span><strong>${escapeHtml(formatDate(item.createdAt, true))}</strong></div>
  </div>`;
  if (view === "inbox") {
    body += `<div class="detail-section"><span>整理結果</span><p>${escapeHtml(item.result || "まだ整理されていません")}</p></div>
      <div class="drawer-actions">
        <button class="secondary-action" id="editInboxButton" type="button">Inboxを編集</button>
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Inboxをクローズ</button>' : ""}
        <button class="primary-action" id="createWantButton" type="button">Wantとして追加</button>
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
  }
  if (view === "wants") {
    body += `<div class="detail-section">${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</div>
      <div class="drawer-actions">
        <button class="secondary-action" id="editWantButton" type="button">Wantを編集</button>
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Wantをクローズ</button>' : ""}
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
  }
  els.drawerBody.innerHTML = body;
  document.getElementById("editInboxButton")?.addEventListener("click", () => renderInboxEditForm(item));
  document.getElementById("createWantButton")?.addEventListener("click", () => renderCreateFlowForm(item, "inbox"));
  document.getElementById("editWantButton")?.addEventListener("click", () => renderItemEditForm(item, "wants"));
  document.getElementById("closeItemButton")?.addEventListener("click", () => closeItem(item, view));
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
    const payload = await response.json().catch(() => ({}));
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
    const payload = await response.json().catch(() => ({}));
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
    const payload = await response.json().catch(() => ({}));
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

function renderCreateFlowForm(sourceItem, sourceView) {
  const meta = createFlowMeta[sourceView];
  if (!meta) return;
  const initialContent = sourceView === "inbox" ? sourceItem.content : "";
  els.drawerTitle.textContent = meta.title;
  els.drawerBody.innerHTML = `<form class="edit-form" id="createFlowForm">
    <div class="source-context">
      <span>${escapeHtml(meta.sourceLabel)}</span>
      <p>${escapeHtml(sourceItem.content)}</p>
    </div>
    <p class="flow-note">${escapeHtml(meta.note)}</p>
    <label class="form-field" for="createFlowContent">
      <span>内容</span>
      <textarea id="createFlowContent" name="content" rows="7" maxlength="2000" required placeholder="Wantの内容">${escapeHtml(initialContent)}</textarea>
      <small><b id="createFlowContentCount">${initialContent.length}</b> / 2000</small>
    </label>
    <p class="form-error" id="createFlowError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelCreateFlow" type="button">キャンセル</button>
      <button class="primary-action" id="saveCreateFlow" type="submit">${escapeHtml(meta.submit)}</button>
    </div>
  </form>`;

  const form = document.getElementById("createFlowForm");
  const content = document.getElementById("createFlowContent");
  content.addEventListener("input", () => { document.getElementById("createFlowContentCount").textContent = content.value.length; });
  document.getElementById("cancelCreateFlow").addEventListener("click", () => renderDrawerItem(sourceItem, sourceView));
  form.addEventListener("submit", (event) => saveCreateFlow(event, sourceItem, sourceView));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setCreateFlowError(message) {
  const error = document.getElementById("createFlowError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function markInboxPromoted(sourceItem) {
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
      result: "Wantsに登録",
      original: {
        content: sourceItem.content,
        status: sourceItem.status,
        result: sourceItem.result ?? null,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "元のInboxを処理済みにできませんでした。");
}

async function saveCreateFlow(event, sourceItem, sourceView) {
  event.preventDefault();
  const form = event.currentTarget;
  const meta = createFlowMeta[sourceView];
  const content = form.elements.content.value.trim();
  if (!content) {
    setCreateFlowError("内容を入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveCreateFlow");
  const cancel = document.getElementById("cancelCreateFlow");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setCreateFlowError("");

  try {
    const requestBody = { content };
    const response = await fetch(meta.endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": meta.actionHeader,
      },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || `${meta.title}に失敗しました。`);
    if (!Number.isSafeInteger(Number(payload.id))) throw new Error("保存結果を確認できませんでした。");

    let sourceUpdateWarning = "";
    if (sourceView === "inbox") {
      try {
        await markInboxPromoted(sourceItem);
      } catch {
        sourceUpdateWarning = "Wantは追加しましたが、Inboxを処理済みにできませんでした。Inboxを再読込して確認してください。";
      }
    }

    state.view = meta.targetView;
    state.status = defaultStatusByView[meta.targetView];
    state.search = "";
    state.metricFilter = "";
    els.searchInput.value = "";
    state.drawerItem = { id: Number(payload.id), view: meta.targetView };
    const refreshed = await loadDashboard();
    if (!refreshed) {
      setCreateFlowError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast(sourceUpdateWarning || meta.success);
  } catch (error) {
    setCreateFlowError(error instanceof Error ? error.message : `${meta.title}に失敗しました。`);
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = meta.submit;
    }
  }
}

function openDrawer(id, view = state.view) {
  const item = (state.data?.[view] || []).find((entry) => entry.id === id);
  if (!item) return;
  state.drawerItem = { id, view };
  renderDrawerItem(item, view);
  els.drawerBackdrop.hidden = false;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els.drawerClose.focus();
}

function closeDrawer() {
  state.drawerItem = null;
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
    state.status = defaultStatusByView.inbox;
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

function setView(view, filter = defaultStatusByView[view]) {
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
    if (state.drawerItem) openDrawer(state.drawerItem.id, state.drawerItem.view);
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
