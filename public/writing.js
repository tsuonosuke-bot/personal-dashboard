const statusMeta = {
  candidate: { label: "アイデア", className: "candidate" },
  completed: { label: "完了", className: "completed" },
};

const state = { items: [], view: "candidate", search: "", selectedId: null };
const els = Object.fromEntries([
  "refreshButton", "candidateCount", "completedCount",
  "candidateTabCount", "completedTabCount", "sourceBadge", "boardTitle",
  "searchInput", "clearFilters", "resultCount", "loadingState", "errorState",
  "errorMessage", "retryButton", "topicList", "editorModal", "editorBackdrop", "editorClose",
  "editorKicker", "editorTitle", "editorForm", "sourceWantLink", "titleInput", "questionInput",
  "editorStatus", "formError", "editorCancel",
  "saveButton", "toast",
].map((id) => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value, includeTime = false) {
  if (!value) return "未設定";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", includeTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 4000);
}

function routeId() {
  const raw = new URL(window.location.href).searchParams.get("id");
  if (raw === null) return { id: null, invalid: false };
  const id = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(id)
    ? { id, invalid: false }
    : { id: null, invalid: true };
}

function routePath(id = null) {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("id");
  else url.searchParams.set("id", String(id));
  return `${url.pathname}${url.search}${url.hash}`;
}

function summary() {
  return {
    candidate: state.items.filter((item) => item.status === "candidate").length,
    completed: state.items.filter((item) => item.status === "completed").length,
  };
}

function renderSummary() {
  const counts = summary();
  els.candidateCount.textContent = counts.candidate;
  els.completedCount.textContent = counts.completed;
  els.candidateTabCount.textContent = counts.candidate;
  els.completedTabCount.textContent = counts.completed;
}

function itemsForView() {
  let items = state.items.filter((item) => item.status === state.view);
  const needle = state.search.trim().toLocaleLowerCase("ja");
  if (needle) {
    items = items.filter((item) => [item.title, item.question]
      .filter(Boolean).some((value) => value.toLocaleLowerCase("ja").includes(needle)));
  }
  return items;
}

function cardMarkup(item) {
  const status = statusMeta[item.status];
  return `<article class="topic-card">
    <button class="topic-open" type="button" data-topic-id="${item.id}">
      <span class="topic-status ${status.className}">${escapeHtml(status.label)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.question || "論点はまだありません")}</p>
      <span class="topic-updated">${escapeHtml(formatDate(item.updatedAt, true))} 更新</span>
    </button>
    <footer><a href="/compass/?view=wants&id=${item.sourceWantId}">元Want #${item.sourceWantId}</a></footer>
  </article>`;
}

function renderList() {
  renderSummary();
  const items = itemsForView();
  els.boardTitle.textContent = state.view === "candidate" ? "アイデア" : "完了したテーマ";
  els.resultCount.textContent = `${items.length}件を表示`;
  els.clearFilters.hidden = !state.search;
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (!items.length) {
    const message = state.view === "completed" ? "完了したテーマはまだありません" : "Writingのアイデアはありません";
    els.topicList.innerHTML = `<div class="empty"><span>✎</span><h3>${message}</h3><p>IdeaでWantをWritingへ振り分けると、ここに追加されます。</p><a href="/compass/?view=wants">Ideaを開く →</a></div>`;
  } else {
    els.topicList.innerHTML = items.map(cardMarkup).join("");
  }
  els.topicList.querySelectorAll("[data-topic-id]").forEach((button) => {
    button.addEventListener("click", () => openEditor(Number(button.dataset.topicId)));
  });
}

function fillStatusOptions() {
  els.editorStatus.innerHTML = Object.entries(statusMeta)
    .map(([value, meta]) => `<option value="${value}">${escapeHtml(meta.label)}</option>`).join("");
}

function showEditor(item) {
  state.selectedId = item.id;
  els.editorKicker.textContent = `WRITING · ${item.id}`;
  els.editorTitle.textContent = item.title;
  els.sourceWantLink.href = `/compass/?view=wants&id=${item.sourceWantId}`;
  els.sourceWantLink.textContent = `Want #${item.sourceWantId}を確認 →`;
  els.titleInput.value = item.title;
  els.questionInput.value = item.question || "";
  els.editorStatus.value = item.status;
  els.formError.hidden = true;
  els.editorModal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => els.titleInput.focus(), 0);
}

function openEditor(id, historyMode = "push") {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return false;
  showEditor(item);
  if (historyMode === "push") window.history.pushState({ writingEditor: true }, "", routePath(id));
  return true;
}

function hideEditor() {
  state.selectedId = null;
  els.editorModal.hidden = true;
  document.body.style.overflow = "";
}

function closeEditor(sync = true) {
  const current = routeId();
  if (sync && current.id !== null && window.history.state?.writingEditor) {
    window.history.back();
    return;
  }
  hideEditor();
  if (sync) window.history.replaceState(null, "", routePath());
}

function applyRoute(notify = true) {
  const target = routeId();
  hideEditor();
  if (target.invalid) {
    window.history.replaceState(null, "", routePath());
    if (notify) showToast("指定されたWritingテーマを開けません。一覧を表示します。");
    return;
  }
  if (target.id !== null && !openEditor(target.id, "none")) {
    window.history.replaceState(null, "", routePath());
    if (notify) showToast("対象のWritingテーマが見つかりません。一覧を表示します。");
  }
}

async function loadWriting() {
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.topicList.hidden = true;
  try {
    const response = await fetch("/api/writing", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok || !Array.isArray(payload.items)) throw new Error(message || "Writingテーマを読み込めませんでした。");
    state.items = payload.items;
    els.sourceBadge.textContent = "SUPABASE LIVE";
    els.sourceBadge.className = "source-badge live";
    renderList();
    els.loadingState.hidden = true;
    els.topicList.hidden = false;
    applyRoute();
    return true;
  } catch (error) {
    els.sourceBadge.textContent = "接続エラー";
    els.sourceBadge.className = "source-badge error";
    els.loadingState.hidden = true;
    els.errorMessage.textContent = error instanceof Error ? error.message : "Writingテーマを読み込めませんでした。";
    els.errorState.hidden = false;
    return false;
  } finally {
    els.refreshButton.disabled = false;
  }
}

async function saveTopic(event) {
  event.preventDefault();
  const item = state.items.find((candidate) => candidate.id === state.selectedId);
  if (!item) return;
  els.saveButton.disabled = true;
  els.editorCancel.disabled = true;
  els.formError.hidden = true;
  try {
    const response = await fetch("/api/writing", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "writing-update" },
      body: JSON.stringify({
        id: item.id,
        title: els.titleInput.value,
        question: els.questionInput.value || null,
        status: els.editorStatus.value,
        originalUpdatedAt: item.updatedAt,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok || !payload.item) throw new Error(message || "Writingテーマを保存できませんでした。");
    state.items = [payload.item, ...state.items.filter((candidate) => candidate.id !== item.id)];
    renderList();
    closeEditor(false);
    window.history.replaceState(null, "", routePath());
    showToast("Writingテーマを保存しました。");
  } catch (error) {
    els.formError.textContent = error instanceof Error ? error.message : "Writingテーマを保存できませんでした。";
    els.formError.hidden = false;
  } finally {
    els.saveButton.disabled = false;
    els.editorCancel.disabled = false;
  }
}

fillStatusOptions();
document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => {
  state.view = tab.dataset.view; renderList();
}));
document.querySelectorAll("[data-summary-view]").forEach((button) => button.addEventListener("click", () => {
  state.view = button.dataset.summaryView; renderList();
}));
els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; renderList(); });
els.clearFilters.addEventListener("click", () => { state.search = ""; els.searchInput.value = ""; renderList(); });
els.refreshButton.addEventListener("click", loadWriting);
els.retryButton.addEventListener("click", loadWriting);
els.editorClose.addEventListener("click", () => closeEditor());
els.editorBackdrop.addEventListener("click", () => closeEditor());
els.editorCancel.addEventListener("click", () => closeEditor());
els.editorForm.addEventListener("submit", saveTopic);
window.addEventListener("popstate", () => applyRoute());
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.editorModal.hidden) closeEditor(); });
loadWriting();
