// ドロワーとInbox追加モーダルの開閉、Inboxの追加。
import { readApiJson } from "../api-client.js";
import { parseCompassRoute } from "../compass-routing.js";
import { PRIMARY_INBOX_ROUTES, defaultStatusByView, inboxQuickRoutes, quickWantRoutes, routeCompletionMeta, routeDestinationMeta, viewMeta } from "./constants.js";
import { loadDashboard } from "./data.js";
import { closeItem, renderInboxEditForm, renderItemEditForm } from "./edit-forms.js";
import { calendarSchedule, escapeHtml, formatCalendarSchedule, formatDate, setDrawerTitle, showToast, sourceChipMarkup, splitInboxSource } from "./format.js";
import { canCloseItem, itemStatusLabel, syncCompassRoute } from "./list.js";
import { startProjectRoute } from "./project-route.js";
import { renderRouteCompletion, renderTriageStart, requestAiTriage, startInboxRoute, startQuickWantRoute } from "./route.js";
import { els, state } from "./state.js";
import { renderTodoDrawer } from "./todos.js";
import { unsortedInboxCount, rememberInboxOrder } from "./triage-flow.js";

function quickRouteButton(key, quick) {
  return `<button class="quick-route-action" type="button" data-inbox-route="${key}"><strong>${escapeHtml(quick.label)}</strong><small>${escapeHtml(quick.description)}</small></button>`;
}

export function renderDrawerItem(item, view) {
  if (view === "todos") {
    renderTodoDrawer(item);
    return;
  }
  state.triageSource = view;
  if (view === "inbox") {
    const { body: text, source } = splitInboxSource(item.content);
    const pending = item.status === "pending";
    els.drawerKicker.textContent = pending
      ? `${viewMeta[view].singular} · ${item.id} · 未整理 残り${unsortedInboxCount()}件`
      : `${viewMeta[view].singular} · ${item.id}`;
    setDrawerTitle(text || "内容なし", { content: true });
    const meta = `<p class="drawer-meta">${escapeHtml(itemStatusLabel(item, view))} · ${escapeHtml(formatDate(item.createdAt, true))}</p>
      ${source ? `<p class="drawer-source">${sourceChipMarkup(source)}</p>` : ""}`;
    // 未整理なら、まずAIの案を聞くか、よく使う振り分け先を選ぶ。残りの行き先・目的からの選択・Projectは畳む。
    const quickRouteMarkup = pending
      ? `<div class="detail-section quick-route-section">
          <button class="ai-triage-button inbox-ai-button" id="askAiInboxButton" type="button">AIに振り分け案を聞く</button>
          <p class="ai-data-note">押した時だけ、本文をClaude APIへ送信します。案を確かめてから保存します。</p>
          <span class="quick-route-label">自分で選ぶ</span>
          <div class="quick-route-actions primary-routes" role="group" aria-label="よく使う振り分け先">
            ${PRIMARY_INBOX_ROUTES.map((key) => quickRouteButton(key, inboxQuickRoutes[key])).join("")}
          </div>
          <details class="more-routes">
            <summary>その他の振り分け先</summary>
            <div class="quick-route-actions" role="group" aria-label="その他の振り分け先">
              ${Object.entries(inboxQuickRoutes).filter(([key]) => !PRIMARY_INBOX_ROUTES.includes(key)).map(([key, quick]) => quickRouteButton(key, quick)).join("")}
            </div>
            <button class="text-button more-routes-intent" id="triageInboxButton" type="button">目的から選ぶ（行動する・掘り下げる…）</button>
            <div class="project-route-divider"><span>複数の行動になるなら</span></div>
            <button class="project-route-action" type="button" data-project-route><strong>Projectとして進める</strong><small>完了条件と最初のNext Actionを決める</small></button>
          </details>
        </div>`
      : `<div class="detail-section"><span>整理結果</span><p>${escapeHtml(item.result || "整理結果はありません")}</p></div>`;
    els.drawerBody.innerHTML = `${meta}
      ${quickRouteMarkup}
      <div class="drawer-actions">
        <button class="secondary-action" id="editInboxButton" type="button">Inboxを編集</button>
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Inboxをクローズ</button>' : ""}
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
    document.getElementById("editInboxButton").addEventListener("click", () => renderInboxEditForm(item));
    document.getElementById("askAiInboxButton")?.addEventListener("click", () => requestAiTriage(item));
    document.getElementById("triageInboxButton")?.addEventListener("click", () => renderTriageStart(item));
    els.drawerBody.querySelectorAll("[data-inbox-route]").forEach((button) => button.addEventListener("click", () => startInboxRoute(item, button.dataset.inboxRoute)));
    els.drawerBody.querySelector("[data-project-route]")?.addEventListener("click", () => startProjectRoute(item, view));
    document.getElementById("closeItemButton")?.addEventListener("click", () => closeItem(item, view));
    return;
  }
  els.drawerKicker.textContent = `${viewMeta[view].singular} · ${item.id}`;
  setDrawerTitle(item.content || "内容なし", { content: true });
  let body = `<div class="detail-grid">
    <div class="detail-box"><span>Status</span><strong>${escapeHtml(itemStatusLabel(item, view))}</strong></div>
    <div class="detail-box"><span>Created</span><strong>${escapeHtml(formatDate(item.createdAt, true))}</strong></div>
  </div>`;
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
          const completion = route.status === "planned" ? routeCompletionMeta[route.destination] : null;
          const completeAction = completion
            ? `<button class="route-action" type="button" data-route-complete="${route.id}">${escapeHtml(completion.action)}</button>`
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
  document.getElementById("editWantButton")?.addEventListener("click", () => renderItemEditForm(item, "wants"));
  document.getElementById("triageWantButton")?.addEventListener("click", () => renderTriageStart(item));
  els.drawerBody.querySelectorAll("[data-quick-route]").forEach((button) => button.addEventListener("click", () => startQuickWantRoute(item, button.dataset.quickRoute)));
  els.drawerBody.querySelector("[data-project-route]")?.addEventListener("click", () => startProjectRoute(item, view));
  els.drawerBody.querySelectorAll("[data-route-complete]").forEach((button) => button.addEventListener("click", () => {
    const route = (item.routes || []).find((entry) => entry.id === Number(button.dataset.routeComplete));
    if (route) renderRouteCompletion(item, route);
  }));
  document.getElementById("closeItemButton")?.addEventListener("click", () => closeItem(item, view));
}

export function hideDrawer() {
  state.aiRequestToken += 1;
  state.drawerItem = null;
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
  document.body.style.overflow = "";
}

export function openDrawer(id, view = state.view, historyMode = "push") {
  const item = (state.data?.[view] || []).find((entry) => entry.id === id);
  if (!item) return false;
  state.aiRequestToken += 1;
  state.drawerItem = { id, view };
  if (view === "inbox") rememberInboxOrder();
  renderDrawerItem(item, view);
  els.drawerBackdrop.hidden = false;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els.drawerClose.focus();
  if (historyMode !== "none") syncCompassRoute(view, id, historyMode);
  return true;
}

export function closeDrawer(sync = true) {
  const route = parseCompassRoute(window.location.href);
  if (sync && route.id !== null && window.history.state?.compassDrawer) {
    window.history.back();
    return;
  }
  hideDrawer();
  if (sync) syncCompassRoute(state.view, null, "replace", state.metricFilter);
}

export function setModalOpen(open) {
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

export async function createInbox(event) {
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
