const ids = [
  "sourceBadge", "refreshButton", "dateLabel", "updatedLabel",
  "compassLink", "habitsLink", "financialLink", "knowledgeLink", "compassMeta", "habitsMeta", "financialMeta", "knowledgeMeta",
  "spendMetricLink", "reviewMetricLink", "reviewStartLink", "currentMonthSpend", "spendComparison", "dueKnowledge",
  "weakKnowledge", "pendingInbox", "habitMetricLink", "remainingHabits", "habitProgress", "loadingState", "errorState", "errorMessage",
  "retryButton", "hubContent", "wantList", "expenseList", "knowledgeList", "journalList", "allWantsLink", "allExpensesLink", "allKnowledgeLink",
];

const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

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
  els.compassLink.href = navigation.compass;
  els.financialLink.href = navigation.financial;
  els.knowledgeLink.href = navigation.knowledge;
  els.habitsLink.href = navigation.habits;
  els.spendMetricLink.href = navigation.financial;
  els.reviewMetricLink.href = navigation.knowledge;
  els.reviewStartLink.href = navigation.knowledgeReview;
  els.habitMetricLink.href = navigation.habits;
  els.allWantsLink.href = navigation.compass;
  els.allExpensesLink.href = navigation.financial;
  els.allKnowledgeLink.href = navigation.knowledge;
}

function renderSummary(summary) {
  els.currentMonthSpend.textContent = formatYen(summary.currentMonthSpend);
  els.dueKnowledge.textContent = formatCount(summary.dueKnowledge);
  els.pendingInbox.textContent = formatCount(summary.pendingInbox);
  els.weakKnowledge.textContent = Number.isFinite(summary.weakKnowledge) ? `苦手候補 ${summary.weakKnowledge}件` : "取得できません";
  els.compassMeta.textContent = `未整理 ${formatCount(summary.pendingInbox)} · Wants ${formatCount(summary.activeWants)}`;
  els.financialMeta.textContent = formatYen(summary.currentMonthSpend);
  els.knowledgeMeta.textContent = Number.isFinite(summary.dueKnowledge) ? `期限 ${summary.dueKnowledge}` : "取得できません";
  els.habitsMeta.textContent = Number.isFinite(summary.remainingHabitsToday) ? `残り ${summary.remainingHabitsToday}件` : "取得できません";
  els.remainingHabits.textContent = formatCount(summary.remainingHabitsToday);
  els.habitProgress.textContent = Number.isFinite(summary.completedHabitsToday)
    ? `${summary.completedHabitsToday}件を今日記録`
    : "取得できません";
  if (summary.currentMonthSpend === null || summary.previousMonthSpend === null) {
    els.spendComparison.textContent = "取得できません";
  } else if (summary.previousMonthSpend > 0) {
    const difference = summary.currentMonthSpend - summary.previousMonthSpend;
    els.spendComparison.textContent = `前月比 ${difference >= 0 ? "+" : ""}${formatYen(difference)}`;
  } else {
    els.spendComparison.textContent = "前月データなし";
  }
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
    return `<a class="knowledge-item" href="${escapeHtml(url)}">
      <span class="reason ${reason.className}">${reason.label}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(reason.detail)}</small></div>
      <span aria-hidden="true">→</span>
    </a>`;
  }).join("");
}

function renderWants(items, url, available = true) {
  if (!available) {
    els.wantList.innerHTML = empty("Wantsを取得できませんでした");
    return;
  }
  if (!items.length) {
    els.wantList.innerHTML = empty("Active Wantはありません");
    return;
  }
  els.wantList.innerHTML = items.map((item, index) => `
    <a class="want-card" href="${escapeHtml(url)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.content)}</strong><small>${escapeHtml(formatDate(item.createdAt))} 登録</small></div>
      <b aria-hidden="true">→</b>
    </a>
  `).join("");
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
    const availability = payload.availability || { inbox: true, wants: true, expenses: true, knowledge: true, journal: true, habits: true };
    renderNavigation(payload.navigation);
    renderSummary(payload.summary);
    renderWants(payload.wants, payload.navigation.compass, availability.wants);
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
setClock();
loadHub();
