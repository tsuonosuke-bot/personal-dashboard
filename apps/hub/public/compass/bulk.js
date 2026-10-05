// Inboxの一括操作（複数選択・一括振り分け・一括更新）。
import { readApiJson } from "../api-client.js";
import { BULK_ROUTE_KEYS, DEFER_ROUTE, WISH_ROUTE, inboxQuickRoutes } from "./constants.js";
import { loadDashboard } from "./data.js";
import { inboxExpected, routeInboxViaApi } from "./edit-forms.js";
import { defaultRevisitDate, showToast, todayInTokyo } from "./format.js";
import { currentItems, renderList, statusLabel } from "./list.js";
import { els, state } from "./state.js";

export function clearBulkSelection() {
  state.bulkSelected.clear();
  state.bulkError = "";
}

export function setBulkMode(active) {
  state.bulkMode = Boolean(active) && state.view === "inbox";
  state.bulkSubmitting = false;
  clearBulkSelection();
  renderList();
}

export function renderBulkControls(items) {
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
  const deferring = els.bulkStatusSelect.value === `route:${DEFER_ROUTE}`;
  els.bulkRevisitField.hidden = !deferring;
  els.bulkRevisitOn.disabled = state.bulkSubmitting;
  if (deferring && !els.bulkRevisitOn.value) els.bulkRevisitOn.value = defaultRevisitDate();
  els.bulkApplyButton.textContent = els.bulkStatusSelect.value.startsWith("route:") ? "振り分けを確認" : "変更を確認";
  els.bulkError.textContent = state.bulkError;
  els.bulkError.hidden = !state.bulkError;
}

function bulkRouteTitle(content) {
  const firstLine = String(content || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
  return firstLine.length > 240 ? `${firstLine.slice(0, 239)}…` : firstLine;
}

// 失敗した項目を同じ振り分け先で再試行するときは、同じ処理IDを使い回して重複させない。
function bulkRouteKeyFor(item, key) {
  const cacheKey = `${item.id}:${key}`;
  if (!state.bulkRouteKeys.has(cacheKey)) state.bulkRouteKeys.set(cacheKey, crypto.randomUUID());
  return state.bulkRouteKeys.get(cacheKey);
}

async function routeInboxItem(item, key, revisitOn) {
  const idempotencyKey = bulkRouteKeyFor(item, key);
  const expected = inboxExpected(item);
  if (key === WISH_ROUTE) {
    await routeInboxViaApi(item.id, "wish", { expected }, idempotencyKey);
    return;
  }
  if (key === DEFER_ROUTE) {
    await routeInboxViaApi(item.id, "defer", { expected, revisit_on: revisitOn }, idempotencyKey);
    return;
  }
  const quick = inboxQuickRoutes[key];
  const content = String(item.content || "").trim();
  const title = bulkRouteTitle(content);
  await routeInboxViaApi(item.id, quick.destination, {
    expected,
    intent: quick.intent,
    title,
    detail: title === content ? null : content.slice(0, 2000),
  }, idempotencyKey);
}

async function applyInboxBulkRoute(selected, key) {
  const label = inboxQuickRoutes[key].label;
  const revisitOn = key === DEFER_ROUTE ? els.bulkRevisitOn.value : null;
  if (key === DEFER_ROUTE && (!revisitOn || revisitOn < todayInTokyo())) {
    state.bulkError = "再訪日は今日以降の日付を指定してください。";
    renderList();
    return;
  }
  const pending = selected.filter((item) => item.status === "pending");
  const skipped = selected.length - pending.length;
  if (!pending.length) {
    state.bulkError = "未整理のInboxだけを振り分けられます。";
    renderList();
    return;
  }
  const target = key === DEFER_ROUTE ? `「保留（再訪 ${revisitOn}）」` : `「${label}」`;
  const skippedNote = skipped ? `\n整理済みなど未整理以外の${skipped}件は対象外です。` : "";
  if (!window.confirm(`${pending.length}件のInboxを${target}に振り分けますか？${skippedNote}\n\n各Inboxの内容をそのまま登録し、整理済みにします。`)) return;

  state.bulkSubmitting = true;
  state.bulkError = "";
  renderBulkControls(currentItems());
  const failed = [];
  for (const [index, item] of pending.entries()) {
    els.bulkSelectionCount.textContent = `${index + 1}/${pending.length}件を処理中`;
    try {
      await routeInboxItem(item, key, revisitOn);
      state.bulkRouteKeys.delete(`${item.id}:${key}`);
    } catch (error) {
      failed.push({ id: item.id, message: error instanceof Error ? error.message : "振り分けできませんでした。" });
    }
  }
  state.bulkSubmitting = false;
  await loadDashboard();
  if (failed.length) {
    state.bulkMode = true;
    state.bulkSelected = new Set(failed.map((item) => item.id));
    state.bulkError = `${pending.length - failed.length}件を振り分けました。振り分けできなかったInbox: ${failed.map((item) => `#${item.id}（${item.message}）`).join("、")}`;
    renderList();
    return;
  }
  state.bulkMode = false;
  clearBulkSelection();
  renderList();
  showToast(`${pending.length}件のInboxを${target}に振り分けました。`);
}

export async function applyInboxBulkUpdate() {
  const selected = (state.data?.inbox || []).filter((item) => state.bulkSelected.has(item.id));
  if (!selected.length || state.bulkSubmitting) return;
  if (els.bulkStatusSelect.value.startsWith("route:")) {
    const key = els.bulkStatusSelect.value.slice("route:".length);
    if (BULK_ROUTE_KEYS.includes(key)) await applyInboxBulkRoute(selected, key);
    return;
  }
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
