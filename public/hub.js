const ids = [
  "sourceBadge", "refreshButton", "dayLabel", "dateLabel", "updatedLabel", "greeting",
  "compassLink", "financialLink", "knowledgeLink", "compassMeta", "financialMeta", "knowledgeMeta",
  "spendMetricLink", "reviewMetricLink", "currentMonthSpend", "spendComparison", "dueKnowledge",
  "weakKnowledge", "pendingInbox", "wantsWithoutAction", "loadingState", "errorState", "errorMessage",
  "retryButton", "hubContent", "expenseList", "knowledgeList", "wantList", "allExpensesLink", "allKnowledgeLink",
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
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
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
  const hour = now.getHours();
  els.greeting.textContent = hour < 11 ? "おはようございます。" : hour < 18 ? "こんにちは。" : "おつかれさまです。";
  els.dayLabel.textContent = String(now.getDate()).padStart(2, "0");
  els.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", weekday: "long" }).format(now);
}

function empty(message) {
  return `<div class="empty"><span>◇</span><p>${escapeHtml(message)}</p></div>`;
}

function renderNavigation(navigation) {
  els.compassLink.href = navigation.compass;
  els.financialLink.href = navigation.financial;
  els.knowledgeLink.href = navigation.knowledge;
  els.spendMetricLink.href = navigation.financial;
  els.reviewMetricLink.href = navigation.knowledge;
  els.allExpensesLink.href = navigation.financial;
  els.allKnowledgeLink.href = navigation.knowledge;
}

function renderSummary(summary) {
  els.currentMonthSpend.textContent = formatYen(summary.currentMonthSpend);
  els.dueKnowledge.textContent = `${summary.dueKnowledge}件`;
  els.pendingInbox.textContent = `${summary.pendingInbox}件`;
  els.wantsWithoutAction.textContent = `${summary.wantsWithoutAction}件`;
  els.weakKnowledge.textContent = `苦手候補 ${summary.weakKnowledge}件`;
  els.compassMeta.textContent = `未整理 ${summary.pendingInbox}件 · 次の行動なし ${summary.wantsWithoutAction}件`;
  els.financialMeta.textContent = `今月 ${formatYen(summary.currentMonthSpend)}`;
  els.knowledgeMeta.textContent = `復習期限 ${summary.dueKnowledge}件`;
  if (summary.previousMonthSpend > 0) {
    const difference = summary.currentMonthSpend - summary.previousMonthSpend;
    els.spendComparison.textContent = `前月比 ${difference >= 0 ? "+" : ""}${formatYen(difference)}`;
  } else {
    els.spendComparison.textContent = "前月データなし";
  }
}

function renderExpenses(items) {
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

function renderKnowledge(items, url) {
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

function renderWants(items) {
  if (!items.length) {
    els.wantList.innerHTML = empty("次の行動を待つActive Wantはありません");
    return;
  }
  els.wantList.innerHTML = items.map((item, index) => `
    <a class="want-card" href="/compass/">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.content)}</strong><small>最初の10分でできることは？</small></div>
      <b aria-hidden="true">→</b>
    </a>
  `).join("");
}

function setSource(source, hasError = false) {
  els.sourceBadge.className = `source-badge ${hasError ? "error" : "live"}`;
  els.sourceBadge.querySelector("span").textContent = hasError ? "接続エラー" : "SUPABASE LIVE";
  if (!hasError) els.updatedLabel.textContent = `${formatDate(source.fetchedAt, true)} 更新`;
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
    renderNavigation(payload.navigation);
    renderSummary(payload.summary);
    renderExpenses(payload.recentExpenses);
    renderKnowledge(payload.knowledge, payload.navigation.knowledge);
    renderWants(payload.wants);
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
