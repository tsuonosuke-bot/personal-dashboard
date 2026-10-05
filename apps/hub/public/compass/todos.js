// ToDoとGoogleカレンダー（詳細・状態の変更・日時の変更）。
import { readApiJson } from "../api-client.js";
import { loadTodos } from "./data.js";
import { hideDrawer } from "./drawer.js";
import { dateOffset, escapeHtml, formatCalendarSchedule, nextWeekendDate, showToast, todayInTokyo, todoTiming, todoTimingLabel } from "./format.js";
import { statusLabel, syncCompassRoute } from "./list.js";
import { els, state } from "./state.js";

export async function refreshGoogleCalendarConnection(statusElement, submitButton) {
  statusElement.className = "integration-status loading";
  statusElement.textContent = "Google Calendarの接続状態を確認しています…";
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/google-calendar-status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readApiJson(response);
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

function todoCalendarNotice(item) {
  if (item.calendarState === "unavailable") return "Google Calendarへ接続できないため、前回確認した日時を表示しています。再読み込み後に日程を変更してください。";
  if (item.calendarState === "missing") return "紐づくGoogle Calendar予定が見つかりません。実施する場合は新しい予定として再作成できます。";
  if (item.calendarState === "cancelled") return "Google Calendarでは取消済みです。見送るか、新しい予定として再作成してください。";
  if (item.status === "pending" && todoTiming(item) === "overdue") return "予定時刻を過ぎています。実施済みか、日程を決め直すか、見送るかを選んでください。";
  return "日時変更はGoogle Calendarへ反映されます。完了・見送りはToDoだけを更新し、Calendar予定は変更しません。";
}

export function renderTodoDrawer(item) {
  els.drawerKicker.textContent = `ToDo · ${item.id}`;
  els.drawerTitle.textContent = item.title || "内容なし";
  const canReschedule = item.status === "pending" && item.calendarState === "confirmed" && item.calendarEtag;
  const calendarLink = item.calendarUrl
    ? `<a class="secondary-action action-link" href="${escapeHtml(item.calendarUrl)}" target="_blank" rel="noopener noreferrer">Google Calendarで開く</a>`
    : "";
  const actions = item.status === "pending"
    ? `<button class="primary-action" id="completeTodoButton" type="button">完了にする</button>
       <button class="secondary-action" id="rescheduleTodoButton" type="button" ${canReschedule ? "" : "disabled"}>日程を決め直す</button>
       ${item.calendarState === "missing" || item.calendarState === "cancelled" ? '<button class="secondary-action" id="recreateTodoButton" type="button">新しい予定として再作成</button>' : ""}
       <button class="close-action" id="skipTodoButton" type="button">見送る</button>`
    : `<button class="secondary-action" id="reopenTodoButton" type="button">未実施に戻す</button>`;
  els.drawerBody.innerHTML = `<div class="detail-grid">
      <div class="detail-box"><span>Status</span><strong>${escapeHtml(item.status === "pending" ? todoTimingLabel(item) : statusLabel(item.status, "todos"))}</strong></div>
      <div class="detail-box"><span>Schedule</span><strong>${escapeHtml(formatCalendarSchedule(item.schedule))}</strong></div>
    </div>
    ${item.detail ? `<div class="detail-section"><span>補足</span><p>${escapeHtml(item.detail)}</p></div>` : ""}
    <div class="detail-section todo-source"><span>元の記録</span><p>Want · ${item.sourceWantId}${item.sourceInboxId ? ` / Inbox · ${item.sourceInboxId}` : ""}</p></div>
    <div class="todo-notice ${item.status === "pending" && todoTiming(item) === "overdue" ? "attention" : ""}">${escapeHtml(todoCalendarNotice(item))}</div>
    <label class="form-field todo-note" for="todoNote"><span>実施メモ <small>空欄可</small></span><textarea id="todoNote" rows="4" maxlength="2000" placeholder="実施結果や見送り理由">${escapeHtml(item.note || "")}</textarea></label>
    <div class="drawer-actions">${calendarLink}${actions}</div>
    <p class="form-error" id="todoActionError" role="alert" hidden></p>`;
  document.getElementById("completeTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "complete"));
  document.getElementById("skipTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "skip"));
  document.getElementById("reopenTodoButton")?.addEventListener("click", () => changeTodoStatus(item, "reopen"));
  document.getElementById("rescheduleTodoButton")?.addEventListener("click", () => renderTodoRescheduleForm(item));
  document.getElementById("recreateTodoButton")?.addEventListener("click", () => renderTodoRescheduleForm(item, "recreate"));
}

function setTodoActionError(message) {
  const error = document.getElementById("todoActionError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function todoRequestBody(item, command, options = {}) {
  return {
    id: item.id,
    command,
    note: options.note ?? null,
    schedule: options.schedule ?? null,
    original: {
      status: item.status,
      updatedAt: item.updatedAt,
      calendarEtag: item.calendarEtag,
      schedule: item.schedule,
    },
  };
}

export async function sendTodoUpdate(item, command, options = {}) {
  const response = await fetch("/api/scheduled-actions", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "scheduled-todo-update",
    },
    body: JSON.stringify(todoRequestBody(item, command, options)),
  });
  const payload = await readApiJson(response);
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "ToDoを更新できませんでした。");
  return payload;
}

async function changeTodoStatus(item, command) {
  const button = document.getElementById(`${command === "complete" ? "complete" : command === "skip" ? "skip" : "reopen"}TodoButton`);
  if (!button) return;
  const note = document.getElementById("todoNote")?.value.trim() || null;
  button.disabled = true;
  setTodoActionError("");
  try {
    await sendTodoUpdate(item, command, { note });
    hideDrawer();
    syncCompassRoute("todos", null, "replace", ["overdue", "today", "upcoming"].includes(state.metricFilter) ? state.metricFilter : null);
    await loadTodos(true);
    showToast(command === "complete" ? "ToDoを完了しました。" : command === "skip" ? "ToDoを見送りにしました。" : "ToDoを未実施に戻しました。");
  } catch (error) {
    setTodoActionError(error instanceof Error ? error.message : "ToDoを更新できませんでした。");
    if (button.isConnected) button.disabled = false;
  }
}

function renderTodoRescheduleForm(item, command = "reschedule") {
  const schedule = item.schedule;
  const recreate = command === "recreate";
  els.drawerKicker.textContent = `ToDo · ${item.id}`;
  els.drawerTitle.textContent = recreate ? "Calendar予定を再作成" : "日程を決め直す";
  els.drawerBody.innerHTML = `<form class="edit-form" id="todoRescheduleForm">
    <div class="source-context"><span>対象</span><p>${escapeHtml(item.title)}</p></div>
    <div class="quick-date-actions" role="group" aria-label="日付の候補">
      <button class="filter-chip" type="button" data-quick-date="${dateOffset(0)}">今日</button>
      <button class="filter-chip" type="button" data-quick-date="${dateOffset(1)}">明日</button>
      <button class="filter-chip" type="button" data-quick-date="${nextWeekendDate()}">今週末</button>
    </div>
    <label class="form-field" for="todoScheduleDate"><span>日付</span><input id="todoScheduleDate" name="date" type="date" min="${todayInTokyo()}" value="${escapeHtml(schedule.date)}" required></label>
    <label class="calendar-all-day" for="todoScheduleAllDay"><input id="todoScheduleAllDay" name="allDay" type="checkbox" ${schedule.allDay ? "checked" : ""}><span>終日予定</span></label>
    <div class="calendar-time-fields" id="todoScheduleTimeFields" ${schedule.allDay ? "hidden" : ""}>
      <label class="form-field" for="todoScheduleStart"><span>開始</span><input id="todoScheduleStart" name="startTime" type="time" value="${escapeHtml(schedule.startTime || "09:00")}"></label>
      <label class="form-field" for="todoScheduleEnd"><span>終了</span><input id="todoScheduleEnd" name="endTime" type="time" value="${escapeHtml(schedule.endTime || "09:30")}"></label>
    </div>
    <p class="route-boundary">${recreate ? "削除・取消済みの予定とは別に、新しいGoogle Calendar予定を1件作成してこのToDoへ再接続します。" : "同じGoogle Calendar予定の日時だけを更新します。新しい予定は作成しません。"}</p>
    <p class="form-error" id="todoActionError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="cancelTodoReschedule" type="button">戻る</button><button class="primary-action" id="saveTodoReschedule" type="submit">${recreate ? "新しい予定を作成" : "Calendarの日程を更新"}</button></div>
  </form>`;
  const form = document.getElementById("todoRescheduleForm");
  const allDay = document.getElementById("todoScheduleAllDay");
  const timeFields = document.getElementById("todoScheduleTimeFields");
  const syncTimeRequirement = () => {
    timeFields.hidden = allDay.checked;
    form.elements.startTime.required = !allDay.checked;
    form.elements.endTime.required = !allDay.checked;
  };
  allDay.addEventListener("change", syncTimeRequirement);
  syncTimeRequirement();
  form.querySelectorAll("[data-quick-date]").forEach((button) => button.addEventListener("click", () => {
    form.elements.date.value = button.dataset.quickDate;
  }));
  document.getElementById("cancelTodoReschedule").addEventListener("click", () => renderTodoDrawer(item));
  form.addEventListener("submit", (event) => saveTodoReschedule(event, item, command));
}

async function saveTodoReschedule(event, item, command = "reschedule") {
  event.preventDefault();
  const form = event.currentTarget;
  const allDay = form.elements.allDay.checked;
  const schedule = {
    allDay,
    date: form.elements.date.value,
    startTime: allDay ? null : form.elements.startTime.value,
    endTime: allDay ? null : form.elements.endTime.value,
    timeZone: "Asia/Tokyo",
  };
  if (!schedule.date || (!allDay && (!schedule.startTime || !schedule.endTime || schedule.endTime <= schedule.startTime))) {
    setTodoActionError("新しい日付と時間を確認してください。");
    return;
  }
  const end = allDay ? new Date(`${schedule.date}T23:59:59+09:00`) : new Date(`${schedule.date}T${schedule.endTime}:00+09:00`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
    setTodoActionError("実施予定は現在より後の日時を指定してください。");
    return;
  }
  const submit = document.getElementById("saveTodoReschedule");
  const cancel = document.getElementById("cancelTodoReschedule");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "更新中…";
  setTodoActionError("");
  try {
    await sendTodoUpdate(item, command, { schedule });
    hideDrawer();
    syncCompassRoute("todos", null, "replace", ["overdue", "today", "upcoming"].includes(state.metricFilter) ? state.metricFilter : null);
    await loadTodos(true);
    showToast(command === "recreate" ? "Google Calendarへ新しい予定を作成しました。" : "Google Calendarの日程を更新しました。");
  } catch (error) {
    setTodoActionError(error instanceof Error ? error.message : "日程を変更できませんでした。");
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = command === "recreate" ? "新しい予定を作成" : "Calendarの日程を更新";
    }
  }
}
