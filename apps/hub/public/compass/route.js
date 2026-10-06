// 振り分けの流れ（クイック振り分け・AI提案・行き先ごとのフォーム・保存・完了）。
import { readApiJson } from "../api-client.js";
import { DEFER_ROUTE, WISH_ROUTE, cadenceLabels, destinationsByIntent, inboxQuickRoutes, quickWantRoutes, routeCompletionMeta, routeDestinationMeta, routeIntentMeta, viewMeta } from "./constants.js";
import { loadDashboard } from "./data.js";
import { closeDrawer, renderDrawerItem } from "./drawer.js";
import { inboxExpected, renderDeferForm, renderWishForm, routeInboxViaApi } from "./edit-forms.js";
import { escapeHtml, formatCalendarSchedule, setDrawerTitle, showToast, sourceTextMarkup, splitInboxSource } from "./format.js";
import { els, state } from "./state.js";
import { refreshGoogleCalendarConnection } from "./todos.js";
import { continueInboxTriage } from "./triage-flow.js";

export function triageSourceLabel(view = state.triageSource) {
  return view === "inbox" ? "元のInbox" : "元のWant";
}

export function triageKicker(item, view = state.triageSource) {
  return `${viewMeta[view].singular} · ${item.id}`;
}

export function triageCompletionNote(view = state.triageSource) {
  return view === "inbox" ? "元のInboxを整理済みにします。" : "元のWantも完了します。";
}

export function startQuickWantRoute(item, key) {
  const quick = quickWantRoutes[key];
  if (item.status !== "active" || !quick) return;
  renderRouteForm(item, quick.intent, quick.destination, {}, "quick");
}

export function startInboxRoute(item, key) {
  if (item.status !== "pending") return;
  if (key === DEFER_ROUTE) {
    renderDeferForm(item);
    return;
  }
  if (key === WISH_ROUTE) {
    renderWishForm(item);
    return;
  }
  const quick = inboxQuickRoutes[key];
  if (!quick) return;
  renderRouteForm(item, quick.intent, quick.destination, {}, "quick");
}

export function renderTriageStart(item) {
  els.drawerKicker.textContent = triageKicker(item);
  setDrawerTitle(`この${viewMeta[state.triageSource].singular}をどう扱いますか？`);
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel())}</span>
      ${sourceTextMarkup(item.content)}
    </div>
    <div class="ai-triage-entry">
      <button class="ai-triage-button" id="askAiTriageButton" type="button">AIに整理案を聞く</button>
      <p class="ai-data-note">押した時だけ、本文をClaude APIへ送信します。AIは案を作るだけで、外部登録は行いません。</p>
    </div>
    <div class="triage-divider"><span>または自分で選ぶ</span></div>
    <div class="triage-options" id="triageIntentOptions">
      ${Object.entries(routeIntentMeta).map(([key, meta]) => `<button class="triage-option" type="button" data-intent="${key}"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.description)}</span></button>`).join("")}
    </div>
    <div class="drawer-actions"><button class="secondary-action" id="cancelTriage" type="button">戻る</button></div>`;
  document.getElementById("askAiTriageButton").addEventListener("click", () => requestAiTriage(item));
  document.querySelectorAll("[data-intent]").forEach((button) => button.addEventListener("click", () => renderDestinationStep(item, button.dataset.intent)));
  document.getElementById("cancelTriage").addEventListener("click", () => renderDrawerItem(item, state.triageSource));
}

export async function requestAiTriage(item, answers = null) {
  const requestToken = ++state.aiRequestToken;
  const sourceView = state.triageSource;
  els.drawerKicker.textContent = triageKicker(item, sourceView);
  setDrawerTitle("AIが整理案を作成中");
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel(sourceView))}</span>
      ${sourceTextMarkup(item.content)}
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
        source: sourceView === "inbox" ? "inbox" : "want",
        sourceId: item.id,
        content: item.content,
        answers,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "AI整理案を取得できませんでした。");
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== sourceView) return;
    renderAiSuggestion(item, payload);
  } catch (error) {
    if (requestToken !== state.aiRequestToken || state.drawerItem?.id !== item.id || state.drawerItem?.view !== sourceView) return;
    setDrawerTitle("AI整理案を取得できませんでした");
    els.drawerBody.innerHTML = `<div class="source-context">
        <span>${escapeHtml(triageSourceLabel(sourceView))}</span>
        ${sourceTextMarkup(item.content)}
      </div>
      <p class="form-error" role="alert">${escapeHtml(error instanceof Error ? error.message : "AI整理案を取得できませんでした。")}</p>
      <p class="ai-data-note">${escapeHtml(viewMeta[sourceView].singular)}は変更されていません。手動の振り分けはそのまま利用できます。</p>
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
  els.drawerKicker.textContent = triageKicker(item);
  setDrawerTitle("AIからの整理案");
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(triageSourceLabel())}</span>
      ${sourceTextMarkup(item.content)}
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
    <p class="ai-data-note">これは未保存の案です。「この案を使う」の後に内容を直してから保存します（Google Calendarは確認画面で確定します）。</p>
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
  setDrawerTitle("振り分け先を選ぶ");
  const destinations = destinationsByIntent[intent] || [];
  els.drawerBody.innerHTML = `<div class="source-context">
      <span>${escapeHtml(intentMeta.label)}</span>
      ${sourceTextMarkup(item.content)}
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

function renderRouteForm(item, intent, destination, initial = {}, origin = initial.origin || "triage") {
  const destinationMeta = routeDestinationMeta[destination];
  if (!destinationMeta) return renderDestinationStep(item, intent);
  const title = initial.title ?? splitInboxSource(item.content).body.slice(0, 240);
  // 深掘りから来たInboxは、本文から外した出典を補足に残す（Issueやナレッジから元のカードを辿れるように）。
  const inboxSource = state.triageSource === "inbox" ? splitInboxSource(item.content).source : null;
  const detail = initial.detail ?? (inboxSource ? `深掘り元: ${inboxSource.label}（knowledge ${inboxSource.knowledgeId}）` : "");
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
    question: "補足",
  })[destination] || "補足";
  // 問いでは、タイトルがそのまま問い文になる（Knowledgeの問いページで短い名前が付く）。
  const titleLabel = destination === "question" ? "問い文" : "タイトル";
  // 外部へ実際に書き込むGoogle Calendarだけ確認画面を挟む。それ以外はこの画面から保存する。
  const needsPreview = destination === "calendar";
  const routeBoundary = needsPreview
    ? "確認画面の登録ボタンを押すと、Googleのメインカレンダーへ実際に予定を作成します。"
    : destinationMeta.internal
      ? `保存すると${destinationMeta.label}へ登録し、${triageCompletionNote()}`
      : `この段階では外部へ送信せず、登録計画だけを保存します。${triageCompletionNote()}`;
  const calendarFields = destination === "calendar" ? `
    <div class="integration-status loading" id="calendarConnectionStatus" role="status">Google Calendarの接続状態を確認しています…</div>
    <label class="form-field" for="routeCalendarDate"><span>日付</span><input id="routeCalendarDate" name="calendarDate" type="date" value="${escapeHtml(calendar.date || "")}" required></label>
    <label class="calendar-all-day" for="routeCalendarAllDay"><input id="routeCalendarAllDay" name="calendarAllDay" type="checkbox" ${calendar.allDay ? "checked" : ""}><span>終日予定として登録</span></label>
    <div class="calendar-time-fields" id="calendarTimeFields" ${calendar.allDay ? "hidden" : ""}>
      <label class="form-field" for="routeCalendarStart"><span>開始</span><input id="routeCalendarStart" name="calendarStart" type="time" value="${escapeHtml(calendar.startTime || "09:00")}"></label>
      <label class="form-field" for="routeCalendarEnd"><span>終了</span><input id="routeCalendarEnd" name="calendarEnd" type="time" value="${escapeHtml(calendar.endTime || "09:30")}"></label>
    </div>
    <p class="calendar-time-zone">タイムゾーン: Asia/Tokyo</p>` : "";
  setDrawerTitle(destinationMeta.label);
  els.drawerBody.innerHTML = `<form class="edit-form" id="routeForm">
    <div class="source-context"><span>${escapeHtml(triageSourceLabel())}</span>${sourceTextMarkup(item.content)}</div>
    ${routeBoundary ? `<p class="route-boundary">${escapeHtml(routeBoundary)}</p>` : ""}
    <label class="form-field" for="routeTitle"><span>${escapeHtml(titleLabel)}</span><textarea id="routeTitle" name="title" rows="3" maxlength="240" required>${escapeHtml(title)}</textarea><small><b id="routeTitleCount">${title.length}</b> / 240</small></label>
    <label class="form-field" for="routeDetail"><span>${escapeHtml(detailLabel)} <small>空欄可</small></span><textarea id="routeDetail" name="detail" rows="6" maxlength="2000">${escapeHtml(detail)}</textarea><small><b id="routeDetailCount">${detail.length}</b> / 2000</small></label>
    ${calendarFields}
    ${destination === "habit" ? `<label class="form-field" for="routeCadence"><span>頻度</span><select id="routeCadence" name="cadence">${Object.entries(cadenceLabels).map(([value, label]) => `<option value="${value}" ${cadence === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>` : ""}
    <p class="form-error" id="routeFormError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="backToDestination" type="button">戻る</button><button class="primary-action" id="routeFormSubmit" type="submit" ${destination === "calendar" ? "disabled" : ""}>${needsPreview ? "確認へ" : routeConfirmationLabel(destination)}</button></div>
  </form>`;
  const form = document.getElementById("routeForm");
  const titleInput = document.getElementById("routeTitle");
  const detailInput = document.getElementById("routeDetail");
  const formSubmit = document.getElementById("routeFormSubmit");
  // 保存に失敗して押し直しても二重に登録しないよう、この画面の間は同じキーを使う。
  const idempotencyKey = initial.idempotencyKey ?? crypto.randomUUID();
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
  document.getElementById("backToDestination").addEventListener("click", () => {
    if (origin === "quick") renderDrawerItem(item, state.triageSource);
    else renderDestinationStep(item, intent);
  });
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
    const plan = {
      intent,
      destination,
      title: nextTitle,
      detail: form.elements.detail.value.trim(),
      cadence: destination === "habit" ? form.elements.cadence.value : null,
      calendar: nextCalendar,
      idempotencyKey,
      origin,
    };
    if (needsPreview) {
      renderRoutePreview(item, plan);
      return;
    }
    saveWantRoute(item, plan, {
      submit: formSubmit,
      edit: document.getElementById("backToDestination"),
      error: document.getElementById("routeFormError"),
    });
  });
  titleInput.focus();
}

function renderRoutePreview(item, plan) {
  const intentMeta = routeIntentMeta[plan.intent];
  const destinationMeta = routeDestinationMeta[plan.destination];
  setDrawerTitle("振り分け内容を確認");
  els.drawerBody.innerHTML = `<div class="route-preview">
      <div><span>${escapeHtml(triageSourceLabel())}</span>${sourceTextMarkup(item.content)}</div>
      <div><span>扱い</span><strong>${escapeHtml(intentMeta.label)}</strong></div>
      <div><span>振り分け先</span><strong>${escapeHtml(destinationMeta.label)}</strong></div>
      <div><span>タイトル</span><p>${escapeHtml(plan.title)}</p></div>
      ${plan.detail ? `<div><span>補足</span><p>${escapeHtml(plan.detail)}</p></div>` : ""}
      ${plan.cadence ? `<div><span>頻度</span><strong>${escapeHtml(cadenceLabels[plan.cadence])}</strong></div>` : ""}
      ${plan.calendar ? `<div><span>予定日時</span><strong>${escapeHtml(formatCalendarSchedule(plan.calendar))}</strong><small>メインカレンダー · Asia/Tokyo</small></div>` : ""}
    </div>
    <p class="flow-note">${escapeHtml(plan.destination === "calendar" ? `登録するとGoogle Calendarへ予定を作成し、${triageCompletionNote()}` : destinationMeta.internal ? `確定するとPersonal Dashboard内の管理先へ登録し、${triageCompletionNote()}${plan.destination === "focus" ? "表示中のFocusが5件のときは表示解除中に入り、Hubの「管理」で入れ替えられます。" : ""}` : `確定すると振り分け計画を保存し、${triageCompletionNote()}外部システムへの送信は、接続方法の合意後に別途行います。`)}</p>
    <p class="form-error" id="routeSaveError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="editRoutePlan" type="button">修正する</button><button class="primary-action" id="confirmRoutePlan" type="button">${routeConfirmationLabel(plan.destination)}</button></div>`;
  document.getElementById("editRoutePlan").addEventListener("click", () => renderRouteForm(item, plan.intent, plan.destination, plan, plan.origin));
  document.getElementById("confirmRoutePlan").addEventListener("click", () => saveWantRoute(item, plan, {
    submit: document.getElementById("confirmRoutePlan"),
    edit: document.getElementById("editRoutePlan"),
    error: document.getElementById("routeSaveError"),
  }));
}

function routeConfirmationLabel(destination) {
  return destination === "calendar" ? "Google Calendarに登録して完了" : "振り分けて完了";
}

async function saveWantRoute(item, plan, controls) {
  const { submit, edit, error: errorElement } = controls;
  submit.disabled = true;
  edit.disabled = true;
  submit.textContent = plan.destination === "calendar" ? "Calendarへ登録中…" : "保存中…";
  errorElement.hidden = true;
  const fromInbox = state.triageSource === "inbox";
  try {
    let routeStatus;
    if (fromInbox) {
      const params = {
        expected: inboxExpected(item),
        intent: plan.intent,
        title: plan.title,
        detail: plan.detail || null,
      };
      if (plan.destination === "habit") params.cadence = plan.cadence;
      if (plan.destination === "calendar") params.calendar = plan.calendar;
      const payload = await routeInboxViaApi(item.id, plan.destination, params, plan.idempotencyKey);
      routeStatus = payload.route?.status;
    } else {
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
      const payload = await readApiJson(response);
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      if (!response.ok) throw new Error(message || "振り分けを保存できませんでした。");
      routeStatus = payload.status;
    }

    const refreshed = await loadDashboard();
    if (!refreshed) {
      errorElement.textContent = "振り分けは保存しましたが、最新状態を再読み込みできませんでした。再読込してください。";
      errorElement.hidden = false;
      return;
    }
    const closedLabel = fromInbox ? "Inboxを整理済みにしました" : "Wantを完了しました";
    const message = plan.destination === "calendar" && routeStatus === "created"
      ? `Google Calendarへ予定を登録し、${closedLabel}。`
      : routeStatus === "created" ? `振り分け先へ登録し、${closedLabel}。` : `振り分け計画を保存し、${closedLabel}。外部への登録はまだ行っていません。`;
    if (fromInbox) continueInboxTriage(item, message);
    else showToast(message);
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : "振り分けを保存できませんでした。";
    errorElement.hidden = false;
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      edit.disabled = false;
      submit.textContent = routeConfirmationLabel(plan.destination);
    }
  }
}

export function renderRouteCompletion(item, route) {
  const meta = routeCompletionMeta[route.destination];
  if (!meta) return;
  setDrawerTitle(meta.action);
  els.drawerBody.innerHTML = `<div class="route-preview">
      <div><span>Want</span>${sourceTextMarkup(item.content)}</div>
      <div><span>${escapeHtml(meta.candidate)}</span><p>${escapeHtml(route.title)}</p></div>
    </div>
    <p class="flow-note">${escapeHtml(meta.note)}</p>
    <form class="edit-form" id="routeCompleteForm">
      <label class="form-field" for="routeTargetInput">
        <span>${escapeHtml(meta.label)} <small>空欄可</small></span>
        <input id="routeTargetInput" name="${meta.field}" type="text" maxlength="${meta.maxLength}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(meta.placeholder)}">
        <small>${escapeHtml(meta.help)}</small>
      </label>
      <p class="form-error" id="routeCompleteError" role="alert" hidden></p>
      <div class="drawer-actions">
        <button class="secondary-action" id="cancelRouteComplete" type="button">戻る</button>
        <button class="primary-action" id="confirmRouteComplete" type="submit">登録済みにする</button>
      </div>
    </form>`;
  document.getElementById("cancelRouteComplete").addEventListener("click", () => renderDrawerItem(item, "wants"));
  document.getElementById("routeCompleteForm")
    .addEventListener("submit", (event) => saveRouteCompletion(event, item, route, meta));
}

async function saveRouteCompletion(event, item, route, meta) {
  event.preventDefault();
  const submit = document.getElementById("confirmRouteComplete");
  const errorElement = document.getElementById("routeCompleteError");
  const target = document.getElementById("routeTargetInput").value.trim();
  const failure = `${meta.action.replace(/にする$/, "")}にできませんでした。`;
  const done = meta.action.replace(/する$/, "しました。");
  submit.disabled = true;
  submit.textContent = "更新中…";
  errorElement.hidden = true;
  try {
    const response = await fetch("/api/want-routes", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "want-route-complete",
      },
      body: JSON.stringify({
        routeId: route.id,
        [meta.field]: target || null,
        original: { destination: route.destination, status: route.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || failure);

    const refreshed = await loadDashboard();
    if (!refreshed) {
      closeDrawer();
      showToast(`${done}最新状態は再読込して確認してください。`);
      return;
    }
    const updated = (state.data?.wants || []).find((entry) => entry.id === item.id);
    if (updated) renderDrawerItem(updated, "wants");
    else closeDrawer();
    showToast(`${done}登録待ちから外れます。`);
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : failure;
    errorElement.hidden = false;
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = "登録済みにする";
    }
  }
}
