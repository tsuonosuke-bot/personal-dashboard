const state = {
  data: null,
  view: "inbox",
  status: "pending",
  search: "",
  metricFilter: "",
  drawerItem: null,
  aiRequestToken: 0,
  calendarConnection: null,
};

const els = Object.fromEntries([
  "sourceBadge", "refreshButton",
  "pendingInbox", "inboxTotal", "activeWants", "untriagedWants",
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

const routeIntentMeta = {
  act: { label: "行動する", description: "日時を確保する、またはソフトウェアを変更する" },
  continue: { label: "継続する", description: "繰り返したい行動として管理する" },
  explore: { label: "掘り下げる", description: "調べる、理解する、文章へ育てる" },
  keep: { label: "残しておく", description: "意識事項や記録として保存する" },
  discard: { label: "今回は見送る", description: "理由を残して整理を終える" },
};

const routeDestinationMeta = {
  calendar: { label: "Google Calendar", description: "タスク・予定・調査時間をメインカレンダーへ登録", internal: false },
  github: { label: "GitHub Issue", description: "ソフトウェアの実装候補として保存", internal: false },
  writing: { label: "Writing", description: "掘り下げたいエッセイ候補として登録", internal: true },
  habit: { label: "Habits", description: "継続する習慣として登録", internal: true },
  knowledge: { label: "Knowledge候補", description: "調査・検証後のDB登録候補として保存", internal: false },
  focus: { label: "Focus", description: "繰り返し意識したい言葉として登録", internal: true },
  journal: { label: "Journal候補", description: "その日の記録として保存する計画", internal: false },
  archive: { label: "アーカイブ", description: "外部へ登録せず整理記録だけを残す", internal: true },
};

const destinationsByIntent = {
  act: ["calendar", "github"],
  continue: ["habit"],
  explore: ["calendar", "knowledge", "writing"],
  keep: ["focus", "journal", "archive"],
  discard: ["archive"],
};

const cadenceLabels = {
  daily: "毎日",
  weekdays: "平日",
  weekly: "毎週",
  flexible: "頻度を固定しない",
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

function calendarSchedule(value) {
  const schedule = value?.calendar;
  if (!schedule || schedule.timeZone !== "Asia/Tokyo" || typeof schedule.date !== "string") return null;
  return schedule;
}

function formatCalendarSchedule(schedule) {
  if (!schedule) return "日時未設定";
  const date = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" })
    .format(new Date(`${schedule.date}T00:00:00+09:00`));
  return schedule.allDay ? `${date}（終日）` : `${date} ${schedule.startTime}–${schedule.endTime}`;
}

async function refreshGoogleCalendarConnection(statusElement, submitButton) {
  statusElement.className = "integration-status loading";
  statusElement.textContent = "Google Calendarの接続状態を確認しています…";
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/google-calendar-status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "Google Calendarの接続状態を確認できませんでした。");
    state.calendarConnection = payload;
    if (!payload.configured) {
      statusElement.className = "integration-status error";
      statusElement.textContent = "Google Calendar連携のサーバー設定が未完了です。";
      return;
    }
    if (!payload.connected) {
      statusElement.className = "integration-status action";
      statusElement.innerHTML = '<span>Google Calendarはまだ接続されていません。</span><a href="/api/google-calendar-connect">Google Calendarを接続</a>';
      return;
    }
    statusElement.className = "integration-status connected";
    statusElement.innerHTML = '<span>接続済み · メインカレンダー · Asia/Tokyo</span><a href="/api/google-calendar-connect">Google Calendarを再接続</a>';
    submitButton.disabled = false;
  } catch (error) {
    state.calendarConnection = null;
    statusElement.className = "integration-status error";
    statusElement.textContent = error instanceof Error ? error.message : "Google Calendarの接続状態を確認できませんでした。";
  }
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
  if (state.view === "wants" && state.metricFilter === "untriaged") {
    items = items.filter((item) => item.status === "active" && !(item.routes || []).some((route) => route.status === "planned" || route.status === "created"));
  }
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
  els.untriagedWants.textContent = summary.untriagedWants;
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
  const routes = state.view === "wants" ? (item.routes || []) : [];
  const activeRoutes = routes.filter((route) => route.status === "planned" || route.status === "created");
  const routeSummary = activeRoutes.length > 0
    ? `<span>${activeRoutes.length}件を振り分け済み</span>`
    : state.view === "wants" && item.status === "active" ? "<span>未振り分け</span>" : "";
  return `<button class="item-card" type="button" data-id="${item.id}">
    <div class="item-top"><span class="item-id">${viewMeta[state.view].singular.toUpperCase()} · ${item.id ?? "?"}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
    <h3>${escapeHtml(item.content || "内容なし")}</h3>
    <div class="item-footer"><span>${formatDate(item.createdAt)}</span>${routeSummary}</div>
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
    const routes = item.routes || [];
    const routeMarkup = routes.length > 0
      ? `<ul class="route-list">${routes.map((route) => {
          const meta = routeDestinationMeta[route.destination] || { label: route.destination, internal: false };
          const status = ({ planned: "計画のみ", created: "登録済み", failed: "失敗", cancelled: "取消" })[route.status] || route.status;
          const target = route.targetUrl
            ? `<a href="${escapeHtml(route.targetUrl)}" target="_blank" rel="noopener noreferrer">正本を開く</a>`
            : "";
          const schedule = route.destination === "calendar" ? calendarSchedule(route.destinationData) : null;
          return `<li><div><strong>${escapeHtml(meta.label)}</strong><span class="route-status route-status-${escapeHtml(route.status)}">${escapeHtml(status)}</span></div><p>${escapeHtml(route.title)}</p>${schedule ? `<small>${escapeHtml(formatCalendarSchedule(schedule))}</small>` : ""}${target}</li>`;
        }).join("")}</ul>`
      : '<p class="route-empty">まだ振り分けられていません。</p>';
    body += `${item.note ? `<div class="detail-section"><span>メモ</span><p>${escapeHtml(item.note)}</p></div>` : ""}
      <div class="detail-section"><span>振り分け履歴</span>${routeMarkup}</div>
      <div class="drawer-actions">
        <button class="secondary-action" id="editWantButton" type="button">Wantを編集</button>
        ${item.status === "active" ? '<button class="primary-action" id="triageWantButton" type="button">整理する</button>' : ""}
        ${canCloseItem(item, view) ? '<button class="close-action" id="closeItemButton" type="button">Wantをクローズ</button>' : ""}
      </div>
      <p class="form-error" id="closeItemError" role="alert" hidden></p>`;
  }
  els.drawerBody.innerHTML = body;
  document.getElementById("editInboxButton")?.addEventListener("click", () => renderInboxEditForm(item));
  document.getElementById("createWantButton")?.addEventListener("click", () => renderCreateFlowForm(item, "inbox"));
  document.getElementById("editWantButton")?.addEventListener("click", () => renderItemEditForm(item, "wants"));
  document.getElementById("triageWantButton")?.addEventListener("click", () => renderTriageStart(item));
  document.getElementById("closeItemButton")?.addEventListener("click", () => closeItem(item, view));
}

function renderTriageStart(item) {
  els.drawerKicker.textContent = `Want · ${item.id}`;
  els.drawerTitle.textContent = "このWantをどう扱いますか？";
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>元のWant</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-triage-entry">
      <button class="ai-triage-button" id="askAiTriageButton" type="button">AIに整理案を聞く</button>
      <p class="ai-data-note">押した時だけ、Want本文をClaude APIへ送信します。AIは案を作るだけで、外部登録は行いません。</p>
    </div>
    <div class="triage-divider"><span>または自分で選ぶ</span></div>
    <div class="triage-options" id="triageIntentOptions">
      ${Object.entries(routeIntentMeta).map(([key, meta]) => `<button class="triage-option" type="button" data-intent="${key}"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.description)}</span></button>`).join("")}
    </div>
    <div class="drawer-actions"><button class="secondary-action" id="cancelTriage" type="button">戻る</button></div>`;
  document.getElementById("askAiTriageButton").addEventListener("click", () => requestAiTriage(item));
  document.querySelectorAll("[data-intent]").forEach((button) => button.addEventListener("click", () => renderDestinationStep(item, button.dataset.intent)));
  document.getElementById("cancelTriage").addEventListener("click", () => renderDrawerItem(item, "wants"));
}

async function requestAiTriage(item, answers = null) {
  const requestToken = ++state.aiRequestToken;
  els.drawerKicker.textContent = `Want · ${item.id}`;
  els.drawerTitle.textContent = "AIが整理案を作成中";
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>元のWant</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-loading" role="status"><span aria-hidden="true"></span><p>内容に合う振り分け先を考えています…</p></div>`;
  try {
    const response = await fetch("/api/want-suggestions", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-ai-suggest",
      },
      body: JSON.stringify({
        wantId: item.id,
        content: item.content,
        answers,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "AI整理案を取得できませんでした。");
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== "wants") return;
    renderAiSuggestion(item, payload);
  } catch (error) {
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== "wants") return;
    els.drawerTitle.textContent = "AI整理案を取得できませんでした";
    els.drawerBody.innerHTML = `<div class="source-context">
        <span>元のWant</span>
        <p>${escapeHtml(item.content)}</p>
      </div>
      <p class="form-error" role="alert">${escapeHtml(error instanceof Error ? error.message : "AI整理案を取得できませんでした。")}</p>
      <p class="ai-data-note">Wantは変更されていません。手動の振り分けはそのまま利用できます。</p>
      <div class="drawer-actions"><button class="secondary-action" id="manualTriageAfterAiError" type="button">手動で選ぶ</button><button class="primary-action" id="retryAiTriage" type="button">もう一度聞く</button></div>`;
    document.getElementById("manualTriageAfterAiError").addEventListener("click", () => renderTriageStart(item));
    document.getElementById("retryAiTriage").addEventListener("click", () => requestAiTriage(item, answers));
  }
}

function renderAiSuggestion(item, result) {
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  const questions = Array.isArray(result.questions) ? result.questions : [];
  if (suggestions.length === 0) {
    throw new Error("AI整理案を安全に読み取れませんでした。");
  }
  els.drawerKicker.textContent = `Want · ${item.id}`;
  els.drawerTitle.textContent = "AIからの整理案";
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>元のWant</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="ai-summary"><span>読み取り</span><p>${escapeHtml(result.summary || "整理案を作成しました。")}</p></div>
    ${questions.length > 0 ? `<form class="ai-questions" id="aiClarificationForm">
      <strong>もう少し教えてください</strong>
      ${questions.map((question, index) => `<label class="form-field" for="aiAnswer${index}"><span>${escapeHtml(question)}</span><textarea id="aiAnswer${index}" name="answer" rows="2" maxlength="320" required></textarea></label>`).join("")}
      <button class="secondary-action" type="submit">回答をもとに再提案</button>
    </form>` : ""}
    <div class="ai-suggestions">
      ${suggestions.map((suggestion, index) => {
        const intent = routeIntentMeta[suggestion.intent];
        const destination = routeDestinationMeta[suggestion.destination];
        if (!intent || !destination) return "";
        return `<article class="ai-suggestion-card">
          <div><span>${escapeHtml(intent.label)} → ${escapeHtml(destination.label)}</span>${suggestion.cadence ? `<small>${escapeHtml(cadenceLabels[suggestion.cadence] || suggestion.cadence)}</small>` : ""}</div>
          <h3>${escapeHtml(suggestion.title)}</h3>
          ${suggestion.detail ? `<p>${escapeHtml(suggestion.detail)}</p>` : ""}
          <p class="ai-suggestion-reason">${escapeHtml(suggestion.reason)}</p>
          <button class="primary-action" type="button" data-ai-suggestion="${index}">この案を使う</button>
        </article>`;
      }).join("")}
    </div>
    <p class="ai-data-note">これは未保存の案です。「この案を使う」の後に内容を編集し、確認画面で確定します。</p>
    <div class="drawer-actions"><button class="secondary-action" id="manualTriageAfterAi" type="button">自分で選ぶ</button><button class="secondary-action" id="askAiAgain" type="button">最初から聞き直す</button></div>`;

  document.getElementById("aiClarificationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const answerFields = [...event.currentTarget.querySelectorAll('textarea[name="answer"]')];
    const answers = questions.map((question, index) => `質問${index + 1}: ${question}\n回答${index + 1}: ${answerFields[index].value.trim()}`).join("\n\n");
    requestAiTriage(item, answers);
  });
  els.drawerBody.querySelectorAll("[data-ai-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const suggestion = suggestions[Number(button.dataset.aiSuggestion)];
      if (suggestion) renderRouteForm(item, suggestion.intent, suggestion.destination, suggestion);
    });
  });
  document.getElementById("manualTriageAfterAi").addEventListener("click", () => renderTriageStart(item));
  document.getElementById("askAiAgain").addEventListener("click", () => requestAiTriage(item));
}

function renderDestinationStep(item, intent) {
  const intentMeta = routeIntentMeta[intent];
  if (!intentMeta) return renderTriageStart(item);
  els.drawerTitle.textContent = "振り分け先を選ぶ";
  const destinations = destinationsByIntent[intent] || [];
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(intentMeta.label)}</span>
      <p>${escapeHtml(item.content)}</p>
    </div>
    <div class="triage-options">
      ${destinations.map((destination) => {
        const meta = routeDestinationMeta[destination];
        return `<button class="triage-option" type="button" data-destination="${destination}"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.description)}</span></button>`;
      }).join("")}
    </div>
    <div class="drawer-actions"><button class="secondary-action" id="backToIntent" type="button">戻る</button></div>`;
  document.querySelectorAll("[data-destination]").forEach((button) => button.addEventListener("click", () => renderRouteForm(item, intent, button.dataset.destination)));
  document.getElementById("backToIntent").addEventListener("click", () => renderTriageStart(item));
}

function renderRouteForm(item, intent, destination, initial = {}) {
  const destinationMeta = routeDestinationMeta[destination];
  if (!destinationMeta) return renderDestinationStep(item, intent);
  const title = initial.title ?? item.content.slice(0, 240);
  const detail = initial.detail ?? "";
  const cadence = initial.cadence ?? "daily";
  const calendar = initial.calendar ?? {
    allDay: true,
    date: "",
    startTime: "09:00",
    endTime: "09:30",
    timeZone: "Asia/Tokyo",
  };
  const detailLabel = ({
    calendar: "実行内容・希望日時",
    github: "背景・完了条件",
    writing: "問い・掘り下げたいこと",
    habit: "目的・続けたい理由",
    knowledge: "調べること・検証条件",
    focus: "意味・意識したい理由",
    journal: "残したい背景",
    archive: "見送る理由・補足",
  })[destination] || "補足";
  const routeBoundary = destination === "calendar"
    ? "確認画面の登録ボタンを押すと、Googleのメインカレンダーへ実際に予定を作成します。"
    : destinationMeta.internal ? "" : "この段階では外部へ送信せず、登録計画だけを保存します。";
  const calendarFields = destination === "calendar" ? `
    <div class="integration-status loading" id="calendarConnectionStatus" role="status">Google Calendarの接続状態を確認しています…</div>
    <label class="form-field" for="routeCalendarDate"><span>日付</span><input id="routeCalendarDate" name="calendarDate" type="date" value="${escapeHtml(calendar.date || "")}" required></label>
    <label class="calendar-all-day" for="routeCalendarAllDay"><input id="routeCalendarAllDay" name="calendarAllDay" type="checkbox" ${calendar.allDay ? "checked" : ""}><span>終日予定として登録</span></label>
    <div class="calendar-time-fields" id="calendarTimeFields" ${calendar.allDay ? "hidden" : ""}>
      <label class="form-field" for="routeCalendarStart"><span>開始</span><input id="routeCalendarStart" name="calendarStart" type="time" value="${escapeHtml(calendar.startTime || "09:00")}"></label>
      <label class="form-field" for="routeCalendarEnd"><span>終了</span><input id="routeCalendarEnd" name="calendarEnd" type="time" value="${escapeHtml(calendar.endTime || "09:30")}"></label>
    </div>
    <p class="calendar-time-zone">タイムゾーン: Asia/Tokyo</p>` : "";
  els.drawerTitle.textContent = destinationMeta.label;
  els.drawerBody.innerHTML = `<form class="edit-form" id="routeForm">
    <div class="source-context"><span>元のWant</span><p>${escapeHtml(item.content)}</p></div>
    ${routeBoundary ? `<p class="route-boundary">${escapeHtml(routeBoundary)}</p>` : ""}
    <label class="form-field" for="routeTitle"><span>タイトル</span><textarea id="routeTitle" name="title" rows="3" maxlength="240" required>${escapeHtml(title)}</textarea><small><b id="routeTitleCount">${title.length}</b> / 240</small></label>
    <label class="form-field" for="routeDetail"><span>${escapeHtml(detailLabel)} <small>空欄可</small></span><textarea id="routeDetail" name="detail" rows="6" maxlength="2000">${escapeHtml(detail)}</textarea><small><b id="routeDetailCount">${detail.length}</b> / 2000</small></label>
    ${calendarFields}
    ${destination === "habit" ? `<label class="form-field" for="routeCadence"><span>頻度</span><select id="routeCadence" name="cadence">${Object.entries(cadenceLabels).map(([value, label]) => `<option value="${value}" ${cadence === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>` : ""}
    <p class="form-error" id="routeFormError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="backToDestination" type="button">戻る</button><button class="primary-action" id="routeFormSubmit" type="submit" ${destination === "calendar" ? "disabled" : ""}>確認へ</button></div>
  </form>`;
  const form = document.getElementById("routeForm");
  const titleInput = document.getElementById("routeTitle");
  const detailInput = document.getElementById("routeDetail");
  const formSubmit = document.getElementById("routeFormSubmit");
  titleInput.addEventListener("input", () => { document.getElementById("routeTitleCount").textContent = titleInput.value.length; });
  detailInput.addEventListener("input", () => { document.getElementById("routeDetailCount").textContent = detailInput.value.length; });
  if (destination === "calendar") {
    const allDayInput = document.getElementById("routeCalendarAllDay");
    const timeFields = document.getElementById("calendarTimeFields");
    const updateTimeFields = () => {
      timeFields.hidden = allDayInput.checked;
      form.elements.calendarStart.required = !allDayInput.checked;
      form.elements.calendarEnd.required = !allDayInput.checked;
    };
    allDayInput.addEventListener("change", updateTimeFields);
    updateTimeFields();
    refreshGoogleCalendarConnection(document.getElementById("calendarConnectionStatus"), formSubmit);
  }
  document.getElementById("backToDestination").addEventListener("click", () => renderDestinationStep(item, intent));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextTitle = form.elements.title.value.trim();
    if (!nextTitle) {
      const error = document.getElementById("routeFormError");
      error.textContent = "タイトルを入力してください。";
      error.hidden = false;
      form.elements.title.focus();
      return;
    }
    let nextCalendar = null;
    if (destination === "calendar") {
      const error = document.getElementById("routeFormError");
      if (!state.calendarConnection?.connected) {
        error.textContent = "Google Calendarを接続してから確認へ進んでください。";
        error.hidden = false;
        return;
      }
      const date = form.elements.calendarDate.value;
      const allDay = form.elements.calendarAllDay.checked;
      const startTime = allDay ? null : form.elements.calendarStart.value;
      const endTime = allDay ? null : form.elements.calendarEnd.value;
      if (!date) {
        error.textContent = "Google Calendarへ登録する日付を入力してください。";
        error.hidden = false;
        form.elements.calendarDate.focus();
        return;
      }
      if (!allDay && (!startTime || !endTime || endTime <= startTime)) {
        error.textContent = "終了時刻は開始時刻より後にしてください。";
        error.hidden = false;
        form.elements.calendarStart.focus();
        return;
      }
      nextCalendar = { allDay, date, startTime, endTime, timeZone: "Asia/Tokyo" };
    }
    renderRoutePreview(item, {
      intent,
      destination,
      title: nextTitle,
      detail: form.elements.detail.value.trim(),
      cadence: destination === "habit" ? form.elements.cadence.value : null,
      calendar: nextCalendar,
      idempotencyKey: crypto.randomUUID(),
    });
  });
  titleInput.focus();
}

function renderRoutePreview(item, plan) {
  const intentMeta = routeIntentMeta[plan.intent];
  const destinationMeta = routeDestinationMeta[plan.destination];
  els.drawerTitle.textContent = "振り分け内容を確認";
  els.drawerBody.innerHTML = `<div class="route-preview">
      <div><span>元のWant</span><p>${escapeHtml(item.content)}</p></div>
      <div><span>扱い</span><strong>${escapeHtml(intentMeta.label)}</strong></div>
      <div><span>振り分け先</span><strong>${escapeHtml(destinationMeta.label)}</strong></div>
      <div><span>タイトル</span><p>${escapeHtml(plan.title)}</p></div>
      ${plan.detail ? `<div><span>補足</span><p>${escapeHtml(plan.detail)}</p></div>` : ""}
      ${plan.cadence ? `<div><span>頻度</span><strong>${escapeHtml(cadenceLabels[plan.cadence])}</strong></div>` : ""}
      ${plan.calendar ? `<div><span>予定日時</span><strong>${escapeHtml(formatCalendarSchedule(plan.calendar))}</strong><small>メインカレンダー · Asia/Tokyo</small></div>` : ""}
    </div>
    <p class="flow-note">${plan.destination === "calendar" ? "登録するとGoogle Calendarへ予定を作成し、再取得して確認します。元のWantは自動で完了にしません。" : destinationMeta.internal ? "確定するとPersonal Dashboard内の管理先へ登録します。元のWantは自動で完了にしません。" : "確定しても外部システムには送信しません。接続方法の合意後に、この計画から登録します。"}</p>
    <p class="form-error" id="routeSaveError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="editRoutePlan" type="button">修正する</button><button class="primary-action" id="confirmRoutePlan" type="button">${plan.destination === "calendar" ? "Google Calendarに登録" : "振り分けを確定"}</button></div>`;
  document.getElementById("editRoutePlan").addEventListener("click", () => renderRouteForm(item, plan.intent, plan.destination, plan));
  document.getElementById("confirmRoutePlan").addEventListener("click", () => saveWantRoute(item, plan));
}

async function saveWantRoute(item, plan) {
  const submit = document.getElementById("confirmRoutePlan");
  const edit = document.getElementById("editRoutePlan");
  const errorElement = document.getElementById("routeSaveError");
  submit.disabled = true;
  edit.disabled = true;
  submit.textContent = plan.destination === "calendar" ? "Calendarへ登録中…" : "保存中…";
  errorElement.hidden = true;
  try {
    const response = await fetch("/api/want-routes", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-route-create",
      },
      body: JSON.stringify({
        wantId: item.id,
        intent: plan.intent,
        destination: plan.destination,
        title: plan.title,
        detail: plan.detail || null,
        cadence: plan.cadence,
        calendar: plan.calendar || null,
        idempotencyKey: plan.idempotencyKey,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "振り分けを保存できませんでした。");
    const refreshed = await loadDashboard();
    if (!refreshed) {
      errorElement.textContent = "振り分けは保存しましたが、最新状態を再読み込みできませんでした。再読込してください。";
      errorElement.hidden = false;
      return;
    }
    showToast(plan.destination === "calendar" && payload.status === "created"
      ? "Google Calendarへ予定を登録しました。"
      : payload.status === "created" ? "振り分け先へ登録しました。" : "振り分け計画を保存しました。外部への登録はまだ行っていません。");
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : "振り分けを保存できませんでした。";
    errorElement.hidden = false;
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      edit.disabled = false;
      submit.textContent = plan.destination === "calendar" ? "Google Calendarに登録" : "振り分けを確定";
    }
  }
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
  state.aiRequestToken += 1;
  state.drawerItem = { id, view };
  renderDrawerItem(item, view);
  els.drawerBackdrop.hidden = false;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els.drawerClose.focus();
}

function closeDrawer() {
  state.aiRequestToken += 1;
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
