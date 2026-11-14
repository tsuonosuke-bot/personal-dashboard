import { escapeHtml } from "./shared/html.js";
import { readApiJson } from "./api-client.js";
import { renderJournalTrendHtml } from "./journal-trend.js";
import { createTodayPanel } from "./today-panel.js";
import { renderLearningStages } from "./learning-stages.js";
import { transactionDisplay } from "./transaction-display.js";
import { knowledgeActivity, jstToday } from "./knowledge-activity.js";
import { HOME_HIDDEN_KEY, parseHidden, hubUrl, revealedSections } from "./home-sections.js";
import { skipRequest, restoreRequest, withAdded, withRemoved, inboxMetaLabel } from "./home-inbox.js";

const ids = [
  "sourceBadge", "refreshButton", "quickAddMenu", "dateLabel", "updatedLabel",
  "compassLink", "projectsLink", "habitsLink", "financialLink", "knowledgeLink", "compassMeta", "projectsMeta", "writingMeta", "habitsMeta", "financialMeta", "knowledgeMeta",
  "batchAlert", "batchAlertList", "loadingState", "errorState", "errorMessage", "todayPanel",
  "retryButton", "hubContent", "learningStages", "focusList", "manageFocusButton", "focusModal", "focusModalBackdrop", "closeFocusButton",
  "focusMessage", "focusManageList", "inboxList", "inboxMeta", "writingLink", "expenseList", "knowledgeList", "journalList", "journalTrend", "allInboxLink", "allExpensesLink", "allKnowledgeLink",
  "inboxQuickForm", "inboxQuickInput", "inboxQuickSubmit", "inboxQuickError", "knowledgeQueueMeta",
  "expensesFoldMeta", "knowledgeFoldMeta",
  "homeSettingsButton", "homeSettingsModal", "homeSettingsBackdrop", "homeSettingsClose", "homeSettingsMessage", "homeSettingsList",
];

const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const FOCUS_BOARD_LIMIT = 5;
const today = createTodayPanel(els.todayPanel);
let focusItems = [];
let focusReturnTarget = null;


function formatYen(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatCount(value) {
  return Number.isFinite(value) ? `${value}件` : "—";
}

function labeledCount(label, value) {
  return Number.isFinite(value) ? `${label} ${value}件` : "—";
}

function formatDate(value, includeTime = false) {
  if (!value) return "日付不明";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", includeTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", weekday: "short" }
  ).format(parsed);
}

// 「今日」は端末の時刻帯ではなく、ほかの欄と同じ日本時間で決める。
function setClock() {
  const now = new Date();
  els.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(now);
}

function empty(message) {
  return `<div class="empty"><span>◇</span><p>${escapeHtml(message)}</p></div>`;
}

function renderNavigation(navigation) {
  els.compassLink.href = navigation.compass;
  els.projectsLink.href = navigation.projects || "/projects/";
  els.financialLink.href = navigation.financial;
  els.knowledgeLink.href = navigation.knowledge;
  els.habitsLink.href = navigation.habits;
  els.writingLink.href = navigation.writing || "/writing/";
  els.allInboxLink.href = `${navigation.compass || "/compass/"}?view=inbox`;
  els.allExpensesLink.href = navigation.financial;
  els.allKnowledgeLink.href = navigation.knowledge;
}

/** 問題キューの件数。解ける問題があればKnowledgeから直接復習を始め、なければ通常の入口へ案内する。 */
function renderReview(summary, navigation) {
  const readyDue = summary.reviewReadyDue;
  const activity = knowledgeActivity(summary);
  els.knowledgeLink.href = activity.startReview ? navigation.knowledgeReview : navigation.knowledge;
  els.knowledgeMeta.textContent = activity.label;
  els.knowledgeFoldMeta.textContent = activity.label;
  els.knowledgeLink.title = [
    Number.isFinite(readyDue) ? `すぐ解ける ${readyDue}問` : '復習数を取得できません',
    activity.detail,
    `採点待ち ${formatCount(summary.reviewWaitingGrading)}`,
    `未確認 ${formatCount(summary.reviewUnconfirmed)}`,
    summary.reviewGradingErrors > 0 ? `採点エラー ${summary.reviewGradingErrors}件` : null,
    summary.reviewGenerationHeld > 0 ? `問題を作れず保留 ${summary.reviewGenerationHeld}件` : null,
  ].filter(Boolean).join(" · ");
  // 採点待ち・未確認は、マウスを重ねられない端末でも読めるように見出しにも出す。
  const queue = [
    summary.reviewWaitingGrading > 0 ? `採点待ち ${summary.reviewWaitingGrading}件` : null,
    summary.reviewUnconfirmed > 0 ? `未確認 ${summary.reviewUnconfirmed}件` : null,
  ].filter(Boolean);
  els.knowledgeQueueMeta.hidden = queue.length === 0;
  els.knowledgeQueueMeta.textContent = queue.join(" · ");
}

/** 確認が必要な項目（復習バッチの異常・採点エラー・問題の生成保留・DB容量の逼迫）。無ければ非表示。取得できない（null）ときも出さない。 */
function renderAlerts(summary) {
  const batch = Array.isArray(summary.reviewBatchAlerts) ? summary.reviewBatchAlerts : [];
  const queue = [
    summary.reviewGradingErrors > 0 ? `採点エラーが${summary.reviewGradingErrors}件あります` : null,
    summary.reviewGenerationHeld > 0 ? `問題を作れず保留になったナレッジが${summary.reviewGenerationHeld}件あります` : null,
  ];
  const messages = [...batch, ...queue, summary.databaseAlert].filter((message) => typeof message === "string" && message);
  els.batchAlert.hidden = messages.length === 0;
  els.batchAlertList.replaceChildren(...messages.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
}

function renderSummary(summary, navigation) {
  renderReview(summary, navigation);
  renderAlerts(summary);
  els.inboxMeta.textContent = inboxMetaLabel(summary.pendingInbox, summary.untriagedWants);
  // 1行に収まるよう合計だけを出し、内訳はマウスを重ねたときに見せる。
  const compassDetail = Number.isFinite(summary.untriagedWants)
    ? `Inbox ${formatCount(summary.pendingInbox)} · 未整理のWants ${formatCount(summary.untriagedWants)}`
    : `Inbox ${formatCount(summary.pendingInbox)} · Wants ${formatCount(summary.activeWants)}`;
  const untriaged = (summary.pendingInbox ?? 0) + (summary.untriagedWants ?? 0);
  els.compassMeta.textContent = Number.isFinite(summary.pendingInbox) ? `未整理 ${untriaged}件` : "—";
  els.compassLink.title = compassDetail;
  els.projectsMeta.textContent = labeledCount("進行中", summary.activeProjects);
  els.writingMeta.textContent = labeledCount("アイデア", summary.writingIdeas);
  els.financialMeta.textContent = formatYen(summary.currentMonthSpend);
  els.expensesFoldMeta.textContent = summary.currentMonthSpend === null || summary.currentMonthSpend === undefined ? "" : `今月 ${formatYen(summary.currentMonthSpend)}`;
  els.habitsMeta.textContent = labeledCount("残り", summary.remainingHabitsToday);
}

function renderExpenses(items, available = true) {
  if (!available) {
    els.expenseList.innerHTML = empty("家計簿を取得できませんでした");
    return;
  }
  if (!items.length) {
    els.expenseList.innerHTML = empty("家計簿レコードはまだありません");
    return;
  }
  els.expenseList.innerHTML = items.map((item) => {
    const display = transactionDisplay(item);
    return `
    <div class="record-row">
      <span class="record-date">${escapeHtml(formatDate(item.transactionDate))}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)}${item.payer ? ` · ${escapeHtml(item.payer)}` : ""}</small></div>
      <span class="transaction-money" data-kind="${display.kind}"><small>${display.label}</small><b>${escapeHtml(formatYen(display.amount))}</b></span>
    </div>
  `; }).join("");
}

function knowledgeReason(item) {
  if (item.reason === "weak") return { label: "苦手", className: "weak", detail: item.accuracy === null ? "要復習" : `正答率 ${Math.round(item.accuracy)}%` };
  if (item.reason === "due") return { label: "復習期限", className: "due", detail: item.nextReviewOn ? formatDate(item.nextReviewOn) : "今日" };
  return { label: "新規", className: "new", detail: item.createdAt ? formatDate(item.createdAt) : item.mastery };
}

function renderKnowledge(items, url, available = true) {
  if (!available) {
    els.knowledgeList.innerHTML = empty("ナレッジを取得できませんでした");
    return;
  }
  if (!items.length) {
    els.knowledgeList.innerHTML = empty("表示するナレッジはまだありません");
    return;
  }
  els.knowledgeList.innerHTML = items.map((item) => {
    const reason = knowledgeReason(item);
    return `<a class="knowledge-item" href="${escapeHtml(item.url || url)}">
      <span class="reason ${reason.className}">${reason.label}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(reason.detail)}</small></div>
      <span aria-hidden="true">→</span>
    </a>`;
  }).join("");
}

function renderInbox(items, available = true) {
  if (!available) {
    els.inboxList.innerHTML = empty("Inboxを取得できませんでした");
    return;
  }
  if (!items.length) {
    // 見出しの「未整理のInboxなし」で足りるので、空の一覧は高さを取らない。
    els.inboxList.innerHTML = "";
    return;
  }
  els.inboxList.innerHTML = items.map((item, index) => {
    const age = Number.isFinite(item.ageDays) ? ` · ${item.ageDays}日経過` : "";
    const skip = Number.isSafeInteger(item.id)
      ? `<button class="inbox-skip" type="button" data-inbox-skip="${item.id}" aria-label="「${escapeHtml(item.content)}」を見送る">見送る</button>` : "";
    return `
    <div class="inbox-card">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <a class="inbox-card-link" href="${escapeHtml(item.url || "/compass/?view=inbox")}"><span class="inbox-state">未整理</span><strong>${escapeHtml(item.content)}</strong><small>${escapeHtml(formatDate(item.createdAt))} 登録${age}</small></a>
      ${skip}
    </div>
  `; }).join("");
}

// ホームからの追加・見送り。件数と一覧は手元で先に直し、見送りのあとは裏で取り直して次の1件を補う。
let inboxState = { pending: NaN, items: [] };
let lastSummary = null;
let lastNavigation = null;
let lastAvailability = {};

function renderInboxState() {
  if (!lastSummary) return;
  lastSummary.pendingInbox = inboxState.pending;
  renderSummary(lastSummary, lastNavigation);
  els.learningStages.innerHTML = renderLearningStages(lastSummary, lastAvailability);
  renderInbox(inboxState.items, true);
}

async function inboxApi(method, action, body) {
  const response = await fetch("/api/inbox", {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": action },
    body: JSON.stringify(body),
  });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(payload.error || "Inboxを保存できませんでした。");
  return payload;
}

function shortTitle(content) {
  const line = String(content).split("\n")[0];
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

async function addInbox() {
  const content = els.inboxQuickInput.value.trim();
  if (!content) return;
  els.inboxQuickSubmit.disabled = true;
  els.inboxQuickError.hidden = true;
  try {
    const row = await inboxApi("POST", "inbox-create", { content });
    els.inboxQuickInput.value = "";
    if (Number.isFinite(inboxState.pending) && Number.isSafeInteger(row.id)) {
      inboxState = withAdded(inboxState, row);
      renderInboxState();
    }
    today.notify("Inboxに追加しました");
  } catch (error) {
    // 入力は消さずに残す。
    els.inboxQuickError.textContent = error instanceof Error ? error.message : "Inboxを保存できませんでした。";
    els.inboxQuickError.hidden = false;
  } finally {
    els.inboxQuickSubmit.disabled = false;
    els.inboxQuickInput.focus();
  }
}

async function skipInbox(id, button) {
  const item = inboxState.items.find((candidate) => candidate.id === id);
  if (!item) return;
  button.disabled = true;
  try {
    await inboxApi("PATCH", "inbox-update", skipRequest(item));
    inboxState = withRemoved(inboxState, id);
    renderInboxState();
    void loadHub({ silent: true });
    today.notify(`「${shortTitle(item.content)}」を見送りにしました`, async () => {
      await inboxApi("PATCH", "inbox-update", restoreRequest(item));
      await loadHub({ silent: true });
      return "Inboxへ戻しました";
    });
  } catch (error) {
    button.disabled = false;
    today.notify(error instanceof Error ? error.message : "Inboxを更新できませんでした。");
  }
}

function renderFocus(items, available = true) {
  els.manageFocusButton.disabled = !available;
  if (!available) {
    els.focusList.innerHTML = empty("Focusを取得できませんでした");
    return;
  }
  if (!items.length) {
    els.focusList.innerHTML = `<div class="focus-empty"><span>◇</span><p>今のFocusはまだありません</p><a href="/compass/">Wantから追加する →</a></div>`;
    return;
  }
  els.focusList.innerHTML = items.slice(0, 5).map((item, index) => `
    <button class="focus-card" type="button" data-focus-open="${item.id}" aria-label="${escapeHtml(item.content)}を編集">
      <span class="focus-number">${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(item.content)}</strong>
      ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
    </button>
  `).join("");
}

function setFocusMessage(message = "", isError = false) {
  els.focusMessage.hidden = !message;
  els.focusMessage.className = `focus-message${isError ? " error" : ""}`;
  els.focusMessage.textContent = message;
}

function focusSnapshot(item) {
  return {
    content: item.content,
    note: item.note,
    status: item.status,
    sortOrder: item.sortOrder,
  };
}

function renderFocusManagement() {
  if (!focusItems.length) {
    els.focusManageList.innerHTML = empty("Focusはまだありません");
    return;
  }
  const activeItems = focusItems.filter((item) => item.status === "active");
  els.focusManageList.innerHTML = focusItems.map((item) => {
    const activeIndex = activeItems.findIndex((active) => active.id === item.id);
    const active = item.status === "active";
    return `<form class="focus-editor${active ? "" : " archived"}" data-focus-id="${item.id}">
      <div class="focus-editor-top">
        <span class="focus-status ${active ? "active" : "archived"}">${active ? `表示中 ${activeIndex + 1}/${activeItems.length}` : "表示解除中"}</span>
        ${active ? `<div class="focus-order-actions">
          <button type="button" data-focus-action="up" ${activeIndex === 0 ? "disabled" : ""} aria-label="上へ移動">↑</button>
          <button type="button" data-focus-action="down" ${activeIndex === activeItems.length - 1 ? "disabled" : ""} aria-label="下へ移動">↓</button>
        </div>` : ""}
      </div>
      <label><span>言葉</span><input name="content" maxlength="240" required value="${escapeHtml(item.content)}"></label>
      <label><span>補足</span><textarea name="note" maxlength="2000" rows="2" placeholder="なぜ残したいか（任意）">${escapeHtml(item.note || "")}</textarea></label>
      <div class="focus-editor-actions">
        <button class="focus-save" type="submit">保存</button>
        ${active || activeItems.length < FOCUS_BOARD_LIMIT
          ? `<button class="focus-toggle" type="button" data-focus-action="${active ? "archive" : "activate"}">${active ? "表示から外す" : "再び表示"}</button>`
          : `<button class="focus-toggle" type="button" data-focus-action="swap">入れ替えて表示</button>`}
      </div>
      ${!active && activeItems.length >= FOCUS_BOARD_LIMIT ? `<label class="focus-swap-field"><span>入れ替える表示中Focus</span><select name="swapTarget">
        ${activeItems.map((target, index) => `<option value="${target.id}"${index === activeItems.length - 1 ? " selected" : ""}>${String(index + 1).padStart(2, "0")} ${escapeHtml(target.content)}</option>`).join("")}
      </select></label>` : ""}
    </form>`;
  }).join("");
}

async function focusApi(action, body) {
  const response = await fetch("/api/focus", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
    },
    body: JSON.stringify(body),
  });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(payload.error || "Focusを更新できませんでした。");
  return payload;
}

async function loadFocusManagement(successMessage = "") {
  els.focusManageList.innerHTML = `<div class="focus-loading"><span class="spinner"></span><p>Focusを読み込んでいます</p></div>`;
  const response = await fetch("/api/focus", { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(payload.error || "Focusを読み込めませんでした。");
  focusItems = Array.isArray(payload.items) ? payload.items : [];
  renderFocusManagement();
  renderFocus(focusItems.filter((item) => item.status === "active"), true);
  setFocusMessage(successMessage);
}

async function openFocusModal(selectedId = null) {
  focusReturnTarget = document.activeElement;
  els.focusModal.hidden = false;
  document.body.classList.add("modal-open");
  setFocusMessage();
  try {
    await loadFocusManagement();
    const selected = selectedId ? els.focusManageList.querySelector(`[data-focus-id="${selectedId}"] input`) : null;
    (selected || els.closeFocusButton).focus();
  } catch (error) {
    els.focusManageList.innerHTML = empty("Focusを読み込めませんでした");
    setFocusMessage(error instanceof Error ? error.message : "Focusを読み込めませんでした。", true);
    els.closeFocusButton.focus();
  }
}

function closeFocusModal() {
  els.focusModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (focusReturnTarget instanceof HTMLElement) focusReturnTarget.focus();
  focusReturnTarget = null;
}

function formValues(form) {
  return {
    content: form.elements.content.value,
    note: form.elements.note.value.trim() || null,
  };
}

async function saveFocusForm(form, nextStatus) {
  const id = Number(form.dataset.focusId);
  const item = focusItems.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Focusの最新状態を確認できませんでした。");
  const values = formValues(form);
  await focusApi("focus-update", {
    id,
    content: values.content,
    note: values.note,
    status: nextStatus || item.status,
    original: focusSnapshot(item),
  });
}

async function reorderFocus(itemId, direction) {
  const originalIds = focusItems.filter((item) => item.status === "active").map((item) => item.id);
  const index = originalIds.indexOf(itemId);
  const destination = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || destination < 0 || destination >= originalIds.length) return;
  const ids = [...originalIds];
  [ids[index], ids[destination]] = [ids[destination], ids[index]];
  await focusApi("focus-reorder", { ids, originalIds });
}

function moodLabel(value) {
  return ({ "-2": "かなり低い", "-1": "低い", "0": "普通", "1": "良い", "2": "とても良い" })[String(value)] || "記録なし";
}

function renderJournalTags(entry) {
  const tags = [
    ...(entry.themes || []).map((value) => ({ kind: "テーマ", value })),
    ...(entry.emotions || []).map((value) => ({ kind: "感情", value })),
    ...(entry.entities || []).map((value) => ({ kind: "関連", value })),
    ...(entry.categories || []).map((value) => ({ kind: "分類", value })),
  ];
  if (!tags.length) return "";
  return `<div class="journal-tags">${tags.map((tag) => `<span title="${escapeHtml(tag.kind)}">${escapeHtml(tag.value)}</span>`).join("")}</div>`;
}

function renderJournal(items, available = true) {
  if (!available) {
    els.journalList.innerHTML = empty("Journalを取得できませんでした");
    return;
  }
  if (!items?.length) {
    els.journalList.innerHTML = empty("表示する基準日がありません");
    return;
  }
  els.journalList.innerHTML = items.map((item) => {
    if (!item.entry) {
      return `<article class="journal-card journal-empty">
        <div class="journal-period"><strong>${escapeHtml(item.label)}</strong><small>基準日 ${escapeHtml(formatDate(item.targetDate))}</small></div>
        <p>この基準日以前のJournalはありません</p>
      </article>`;
    }
    const entry = item.entry;
    const difference = entry.daysBeforeTarget === 0 ? "基準日と一致" : `基準日の${entry.daysBeforeTarget}日前`;
    const emotion = entry.emotionSummary
      ? `<div class="journal-detail-row"><dt>感情</dt><dd>${escapeHtml(entry.emotionSummary)}</dd></div>`
      : "";
    const sourcePageUrls = entry.sourcePageUrls || [];
    const sources = sourcePageUrls.length
      ? `<div class="journal-sources">${sourcePageUrls.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Notion原文${sourcePageUrls.length > 1 ? ` ${index + 1}` : ""} ↗</a>`).join("")}</div>`
      : `<p class="journal-no-source">Notion原文リンクなし</p>`;
    return `<details class="journal-card">
      <summary>
        <span class="journal-period"><strong>${escapeHtml(item.label)}</strong><small>基準日 ${escapeHtml(formatDate(item.targetDate))}</small></span>
        <span class="journal-actual"><b>${escapeHtml(formatDate(entry.entryDate))}</b><small>${escapeHtml(difference)}</small></span>
        <span class="journal-excerpt">${escapeHtml(entry.summary)}</span>
        <span class="journal-toggle" aria-hidden="true">＋</span>
      </summary>
      <div class="journal-detail">
        <dl>
          <div class="journal-detail-row"><dt>要約</dt><dd>${escapeHtml(entry.summary)}</dd></div>
          ${emotion}
          <div class="journal-detail-row"><dt>気分</dt><dd>${escapeHtml(moodLabel(entry.mood))}</dd></div>
        </dl>
        ${renderJournalTags(entry)}
        ${sources}
      </div>
    </details>`;
  }).join("");
}

function renderJournalTrend(trend, available = true) {
  els.journalTrend.innerHTML = renderJournalTrendHtml(trend, available);
}

function scrollJournalTrendToLatest() {
  const journalViewport = els.journalTrend.querySelector(".journal-trend-viewport");
  if (journalViewport) journalViewport.scrollLeft = journalViewport.scrollWidth - journalViewport.clientWidth;
}

// たまに見る欄は畳んでおき、開いた欄だけをこの端末に覚える（中身は保存しない）。
const FOLD_STORAGE_KEY = "hub-home-open";

function readOpenFolds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(FOLD_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function setupFolds() {
  const open = readOpenFolds();
  const folds = [...document.querySelectorAll("details[data-fold]")];
  for (const fold of folds) {
    fold.open = open.includes(fold.dataset.fold);
    fold.addEventListener("toggle", () => {
      const keys = folds.filter((node) => node.open).map((node) => node.dataset.fold);
      try {
        window.localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(keys));
      } catch {
        // 保存できない環境では、開閉はこのページを開いている間だけ保たれる。
      }
      // 畳んでいる間は幅が0なので、開いたときに気分の推移を最新側へ寄せる。
      if (fold.open && fold.dataset.fold === "journal") scrollJournalTrendToLatest();
    });
  }
}

function setSource(source, hasError = false) {
  const partial = !hasError && source?.state === "partial";
  els.sourceBadge.className = `source-badge ${hasError ? "error" : partial ? "partial" : "live"}`;
  els.sourceBadge.querySelector("span").textContent = hasError ? "接続エラー" : partial ? "一部取得不可" : "LIVE";
  if (!hasError) els.updatedLabel.textContent = `${formatDate(source.fetchedAt, true)} 更新${partial ? " · 一部取得不可" : ""}`;
}

let hubLoadGeneration = 0;
let hubHasData = false;
let hubLoadController = null;
/** silent: 表示中の内容を残したまま裏で取り直す（読み込み中の表示を出さない）。 */
async function loadHub({ silent = false } = {}) {
  const generation = ++hubLoadGeneration;
  hubLoadController?.abort();
  hubLoadController = new AbortController();
  els.refreshButton.disabled = true;
  els.loadingState.hidden = silent && hubHasData;
  els.errorState.hidden = true;
  els.hubContent.hidden = !hubHasData;
  try {
    const response = await fetch(hubUrl(hiddenSections), { signal: hubLoadController.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (generation !== hubLoadGeneration) return;
    if (!response.ok) throw new Error(payload.error?.message || "データを読み込めませんでした。");
    const availability = payload.availability || { inbox: true, wants: true, focus: true, expenses: true, knowledge: true, journal: true, habits: true };
    renderNavigation(payload.navigation);
    today.setNavigation(payload.navigation);
    renderSummary(payload.summary, payload.navigation);
    lastSummary = payload.summary;
    lastNavigation = payload.navigation;
    lastAvailability = availability;
    inboxState = { pending: payload.summary.pendingInbox ?? NaN, items: payload.inbox || [] };
    els.learningStages.innerHTML = renderLearningStages(payload.summary, availability);
    renderFocus(payload.focus || [], availability.focus);
    renderInbox(payload.inbox || [], availability.inbox);
    renderExpenses(payload.recentExpenses, availability.expenses);
    renderKnowledge(payload.knowledge, payload.navigation.knowledge, availability.knowledge);
    renderJournal(payload.journalMoments, availability.journal);
    renderJournalTrend(payload.journalTrend, availability.journalTrend !== false);
    setSource(payload.source);
    els.loadingState.hidden = true;
    els.hubContent.hidden = false;
    hubHasData = true;
    scrollJournalTrendToLatest();
  } catch (error) {
    if (generation !== hubLoadGeneration) return;
    setSource(null, true);
    els.loadingState.hidden = true;
    els.errorMessage.textContent = error instanceof Error ? error.message : "データを読み込めませんでした。";
    els.errorState.hidden = false;
  } finally {
    if (generation === hubLoadGeneration) els.refreshButton.disabled = false;
  }
}

// ホームの表示設定。非表示の欄の名前をSupabaseに保存し、全端末で共通にする。
// 欄の一覧と名前は index.html の data-home-section / data-home-label から読む。
// 前回の設定は home-boot.js が描画前に当てているので、ここではその続きから始める。
let hiddenSections = parseHidden(document.documentElement.dataset.homeHidden);

function homeSections() {
  const seen = new Map();
  document.querySelectorAll("[data-home-section]").forEach((node) => {
    if (!seen.has(node.dataset.homeSection)) seen.set(node.dataset.homeSection, node.dataset.homeLabel || node.dataset.homeSection);
  });
  return [...seen];
}

function applyHomeSections() {
  const root = document.documentElement;
  root.dataset.homeHidden = hiddenSections.join(" ");
  root.dataset.homeReady = "";
  try {
    window.localStorage.setItem(HOME_HIDDEN_KEY, JSON.stringify(hiddenSections));
  } catch {
    // 保存できない端末では、次に開いたときも設定の取得を待つ。
  }
}

/** 表示している欄のデータを読む。revealed を渡すと、新しく表示した欄の分だけ裏で取り直す。 */
function loadHome(revealed = null) {
  if (!hiddenSections.includes("today") && (!revealed || revealed.includes("today"))) void today.load();
  if (!revealed) void loadHub();
  else if (revealed.some((key) => key !== "today")) void loadHub({ silent: true });
}

function renderHomeSettings() {
  els.homeSettingsList.innerHTML = homeSections().map(([key, label]) =>
    `<label class="home-settings-row"><input type="checkbox" data-home-key="${escapeHtml(key)}"${hiddenSections.includes(key) ? "" : " checked"} /><span>${escapeHtml(label)}</span></label>`).join("");
}

function setHomeSettingsMessage(text = "", isError = false) {
  els.homeSettingsMessage.hidden = !text;
  els.homeSettingsMessage.textContent = text;
  els.homeSettingsMessage.classList.toggle("error", isError);
}

/** 保存済みの設定を読んで当てる。非表示から表示に変わった欄を返す。 */
async function loadHomeSettings() {
  try {
    const response = await fetch("/api/home-settings", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (response.ok && Array.isArray(payload.hidden)) {
      const previous = hiddenSections;
      hiddenSections = payload.hidden;
      applyHomeSections();
      return revealedSections(previous, hiddenSections);
    }
  } catch {
    // 設定を読めなくても、手元の設定（なければ全部表示）のまま続ける。
  }
  document.documentElement.dataset.homeReady = "";
  return [];
}

async function saveHomeSettings(next) {
  const previous = hiddenSections;
  hiddenSections = next;
  applyHomeSections();
  loadHome(revealedSections(previous, next));
  setHomeSettingsMessage();
  try {
    const response = await fetch("/api/home-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "home-settings-update" },
      body: JSON.stringify({ hidden: next }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "保存できませんでした。");
  } catch (error) {
    hiddenSections = previous;
    applyHomeSections();
    renderHomeSettings();
    setHomeSettingsMessage(error instanceof Error ? error.message : "保存できませんでした。", true);
  }
}

function toggleHomeSettings(open) {
  els.homeSettingsModal.hidden = !open;
  if (open) {
    setHomeSettingsMessage();
    renderHomeSettings();
    els.homeSettingsList.querySelector("input")?.focus();
  } else {
    els.homeSettingsButton.focus();
  }
}
els.homeSettingsButton.addEventListener("click", () => toggleHomeSettings(true));
els.homeSettingsClose.addEventListener("click", () => toggleHomeSettings(false));
els.homeSettingsBackdrop.addEventListener("click", () => toggleHomeSettings(false));
els.homeSettingsList.addEventListener("change", () => {
  const hidden = [...els.homeSettingsList.querySelectorAll("input[data-home-key]")]
    .filter((input) => !input.checked).map((input) => input.dataset.homeKey);
  void saveHomeSettings(hidden);
});

// A sleeping tab must never label yesterday's answers as today's achievements.
let displayedDay = jstToday();
function refreshJstDay() {
  if (displayedDay === jstToday()) return;
  displayedDay = jstToday();
  setClock();
  if (lastSummary) renderReview(lastSummary, lastNavigation);
  loadHome();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshJstDay(); });
function scheduleJstMidnight() {
  const next = Date.parse(`${jstToday()}T00:00:00+09:00`) + 86400000;
  window.setTimeout(() => { refreshJstDay(); scheduleJstMidnight(); }, Math.max(1000, next - Date.now()));
}
scheduleJstMidnight();

els.refreshButton.addEventListener("click", () => loadHome());
els.retryButton.addEventListener("click", () => loadHub());
els.inboxQuickForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void addInbox();
});
els.inboxList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inbox-skip]");
  if (button && !button.disabled) void skipInbox(Number(button.dataset.inboxSkip), button);
});
els.manageFocusButton.addEventListener("click", () => openFocusModal());
els.focusList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-focus-open]");
  if (button) openFocusModal(Number(button.dataset.focusOpen));
});
els.closeFocusButton.addEventListener("click", closeFocusModal);
els.focusModalBackdrop.addEventListener("click", closeFocusModal);
els.focusManageList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".focus-editor");
  if (!form) return;
  event.preventDefault();
  setFocusMessage();
  form.querySelectorAll("button, input, textarea").forEach((control) => { control.disabled = true; });
  try {
    await saveFocusForm(form);
    await loadFocusManagement("保存しました。");
  } catch (error) {
    setFocusMessage(error instanceof Error ? error.message : "Focusを更新できませんでした。", true);
    form.querySelectorAll("button, input, textarea").forEach((control) => { control.disabled = false; });
  }
});
els.focusManageList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-focus-action]");
  const form = button?.closest(".focus-editor");
  if (!button || !form) return;
  const action = button.dataset.focusAction;
  const id = Number(form.dataset.focusId);
  setFocusMessage();
  button.disabled = true;
  try {
    if (action === "up" || action === "down") {
      await reorderFocus(id, action);
      await loadFocusManagement("並び順を更新しました。");
    } else if (action === "swap") {
      const archiveId = Number(form.elements.swapTarget?.value);
      if (!archiveId) throw new Error("入れ替える表示中Focusを選んでください。");
      await focusApi("focus-swap", { activateId: id, archiveId });
      await loadFocusManagement("入れ替えて表示しました。外したFocusは表示解除中に残ります。");
    } else {
      await saveFocusForm(form, action === "activate" ? "active" : "archived");
      await loadFocusManagement(action === "activate" ? "Focusに再表示しました。" : "表示から外しました。");
    }
  } catch (error) {
    setFocusMessage(error instanceof Error ? error.message : "Focusを更新できませんでした。", true);
    button.disabled = false;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || today.isOpen()) return;
  if (els.quickAddMenu.open) {
    els.quickAddMenu.removeAttribute("open");
    els.quickAddMenu.querySelector("summary").focus();
  } else if (!els.homeSettingsModal.hidden) toggleHomeSettings(false);
  else if (!els.focusModal.hidden) closeFocusModal();
});
document.addEventListener("click", (event) => {
  if (!els.quickAddMenu.contains(event.target)) els.quickAddMenu.removeAttribute("open");
});
setClock();
setupFolds();
// この端末に前回の設定があれば、それを使ってすぐ読み始める。なければ設定を先に読み、非表示の欄は読まない。
if ("homeReady" in document.documentElement.dataset) {
  loadHome();
  void loadHomeSettings().then((revealed) => { if (revealed.length) loadHome(revealed); });
} else {
  void loadHomeSettings().then(() => loadHome());
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
