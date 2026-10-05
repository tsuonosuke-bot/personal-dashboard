// Idea画面（/compass/）の入口。機能ごとのモジュールは ./compass/ にあり、ここでは
// イベントの結線と初期表示だけを行う。
import { applyInboxBulkUpdate, clearBulkSelection, renderBulkControls, setBulkMode } from "./compass/bulk.js";
import { defaultStatusByView } from "./compass/constants.js";
import { loadDashboard } from "./compass/data.js";
import { closeDrawer, createInbox, setModalOpen } from "./compass/drawer.js";
import { showToast } from "./compass/format.js";
import { applyCompassRoute, currentItems, renderList, setView, syncCompassRoute, updateStatusOptions } from "./compass/list.js";
import { els, state } from "./compass/state.js";

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
els.bulkStatusSelect.addEventListener("change", () => {
  state.bulkError = "";
  renderBulkControls(currentItems());
});
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
