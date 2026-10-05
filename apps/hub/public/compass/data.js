// ダッシュボードとToDoの読み込み。
import { readApiJson } from "../api-client.js";
import { parseCompassRoute } from "../compass-routing.js";
import { escapeHtml, setSource } from "./format.js";
import { applyCompassRoute, renderList, renderNavigation, renderSummary, updateStatusOptions } from "./list.js";
import { els, state } from "./state.js";

export async function loadTodos(render = state.view === "todos") {
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

export async function loadDashboard() {
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
