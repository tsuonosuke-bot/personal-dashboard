const ids = [
  "sourceBadge", "refreshButton", "dateLabel", "updatedLabel",
  "compassLink", "projectsLink", "habitsLink", "financialLink", "knowledgeLink", "compassMeta", "habitsMeta", "financialMeta", "knowledgeMeta",
  "reviewMetricLink", "dueKnowledge", "weakKnowledge", "untriagedMetricLink", "untriagedWants", "oldestUntriaged",
  "habitMetricLink", "remainingHabits", "habitProgress", "loadingState", "errorState", "errorMessage",
  "retryButton", "hubContent", "focusList", "manageFocusButton", "focusModal", "focusModalBackdrop", "closeFocusButton",
  "focusMessage", "focusManageList", "wantList", "wantsMeta", "writingLink", "expenseList", "knowledgeList", "journalList", "allWantsLink", "allExpensesLink", "allKnowledgeLink",
];

const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let focusItems = [];
let focusReturnTarget = null;
let hubNavigation = {};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function formatDate(value, includeTime = false) {
  if (!value) return "日付不明";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", includeTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", weekday: "short" }
  ).format(parsed);
}

function setClock() {
  const now = new Date();
  els.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(now);
}

function empty(message) {
  return `<div class="empty"><span>◇</span><p>${escapeHtml(message)}</p></div>`;
}

function renderNavigation(navigation) {
  hubNavigation = navigation;
  els.compassLink.href = navigation.compass;
  els.projectsLink.href = navigation.projects || "/projects/";
  els.financialLink.href = navigation.financial;
  els.knowledgeLink.href = navigation.knowledge;
  els.habitsLink.href = navigation.habits;
  els.reviewMetricLink.href = navigation.knowledgeReview;
  els.habitMetricLink.href = navigation.habits;
  els.untriagedMetricLink.href = navigation.compassUntriaged || "/compass/?view=wants&filter=untriaged";
  els.writingLink.href = navigation.writing || "/writing/";
  els.allWantsLink.href = navigation.compass;
  els.allExpensesLink.href = navigation.financial;
  els.allKnowledgeLink.href = navigation.knowledge;
}

function renderSummary(summary) {
  els.dueKnowledge.textContent = Number.isFinite(summary.completedKnowledgeToday)
    ? `${summary.completedKnowledgeToday} / ${summary.todayKnowledgeTotal}`
    : "—";
  els.untriagedWants.textContent = formatCount(summary.untriagedWants);
  if (!Number.isFinite(summary.untriagedWants)) {
    els.oldestUntriaged.textContent = "Wantsを取得不可";
    els.wantsMeta.textContent = "Wantsを取得できません";
  } else if (summary.untriagedWants > 0) {
    els.oldestUntriaged.textContent = Number.isFinite(summary.oldestUntriagedDays)
      ? `最古 ${summary.oldestUntriagedDays}日`
      : "最古の登録日は不明";
    els.wantsMeta.textContent = `未整理 ${summary.activeWants}件`;
  } else {
    els.oldestUntriaged.textContent = "すべて完了";
    els.wantsMeta.textContent = "未整理のWantなし";
  }
  els.allWantsLink.href = summary.untriagedWants > 0
    ? (hubNavigation.compassUntriaged || "/compass/?view=wants&filter=untriaged")
    : `${hubNavigation.compass || "/compass/"}?view=wants`;
  els.weakKnowledge.textContent = Number.isFinite(summary.overdueKnowledge)
    ? `期限超過 ${summary.overdueKnowledge}件 · 完了 ${summary.completedKnowledgeToday}件`
    : "取得できません";
  els.compassMeta.textContent = Number.isFinite(summary.untriagedWants)
    ? `Inbox ${formatCount(summary.pendingInbox)} · 未整理 ${formatCount(summary.untriagedWants)}`
    : `Inbox ${formatCount(summary.pendingInbox)} · Wants ${formatCount(summary.activeWants)}`;
  els.financialMeta.textContent = formatYen(summary.currentMonthSpend);
  els.knowledgeMeta.textContent = Number.isFinite(summary.remainingKnowledgeToday)
    ? `今日 残り${summary.remainingKnowledgeToday}件`
    : "取得できません";
  els.habitsMeta.textContent = Number.isFinite(summary.remainingHabitsToday) ? `残り ${summary.remainingHabitsToday}件` : "取得できません";
  els.remainingHabits.textContent = formatCount(summary.remainingHabitsToday);
  els.habitProgress.textContent = Number.isFinite(summary.completedHabitsToday)
    ? `${summary.completedHabitsToday}件を今日記録`
    : "取得できません";
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
  els.expenseList.innerHTML = items.map((item) => `
    <div class="record-row">
      <span class="record-date">${escapeHtml(formatDate(item.transactionDate))}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)}${item.payer ? ` · ${escapeHtml(item.payer)}` : ""}</small></div>
      <b>${escapeHtml(formatYen(item.amount))}</b>
    </div>
  `).join("");
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

function renderWants(items, url, available = true, summary = {}) {
  if (!available) {
    els.wantList.innerHTML = empty("Wantsを取得できませんでした");
    return;
  }
  if (!items.length) {
    els.wantList.innerHTML = empty(summary.activeWants === 0 ? "未整理のWantはありません" : "表示するWantはありません");
    return;
  }
  els.wantList.innerHTML = items.map((item, index) => {
    const age = Number.isFinite(item.ageDays) ? ` · ${item.ageDays}日経過` : "";
    return `
    <a class="want-card" href="${escapeHtml(item.url || url)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><span class="want-triage untriaged">未整理</span><strong>${escapeHtml(item.content)}</strong><small>${escapeHtml(formatDate(item.createdAt))} 登録${age}</small></div>
      <b aria-hidden="true">→</b>
    </a>
  `; }).join("");
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
        <button class="focus-toggle" type="button" data-focus-action="${active ? "archive" : "activate"}">${active ? "表示から外す" : "再び表示"}</button>
      </div>
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Focusを更新できませんでした。");
  return payload;
}

async function loadFocusManagement(successMessage = "") {
  els.focusManageList.innerHTML = `<div class="focus-loading"><span class="spinner"></span><p>Focusを読み込んでいます</p></div>`;
  const response = await fetch("/api/focus", { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
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

function setSource(source, hasError = false) {
  const partial = !hasError && source?.state === "partial";
  els.sourceBadge.className = `source-badge ${hasError ? "error" : partial ? "partial" : "live"}`;
  els.sourceBadge.querySelector("span").textContent = hasError ? "接続エラー" : partial ? "一部取得不可" : "LIVE";
  if (!hasError) els.updatedLabel.textContent = `${formatDate(source.fetchedAt, true)} 更新${partial ? " · 一部取得不可" : ""}`;
}

async function loadHub() {
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.hubContent.hidden = true;
  try {
    const response = await fetch("/api/hub", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "データを読み込めませんでした。");
    const availability = payload.availability || { inbox: true, wants: true, focus: true, expenses: true, knowledge: true, journal: true, habits: true };
    renderNavigation(payload.navigation);
    renderSummary(payload.summary);
    renderFocus(payload.focus || [], availability.focus);
    renderWants(payload.wants, payload.navigation.compass, availability.wants, payload.summary);
    renderExpenses(payload.recentExpenses, availability.expenses);
    renderKnowledge(payload.knowledge, payload.navigation.knowledge, availability.knowledge);
    renderJournal(payload.journalMoments, availability.journal);
    setSource(payload.source);
    els.loadingState.hidden = true;
    els.hubContent.hidden = false;
  } catch (error) {
    setSource(null, true);
    els.loadingState.hidden = true;
    els.errorMessage.textContent = error instanceof Error ? error.message : "データを読み込めませんでした。";
    els.errorState.hidden = false;
  } finally {
    els.refreshButton.disabled = false;
  }
}

els.refreshButton.addEventListener("click", loadHub);
els.retryButton.addEventListener("click", loadHub);
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
  if (event.key === "Escape" && !els.focusModal.hidden) closeFocusModal();
});
setClock();
loadHub();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
