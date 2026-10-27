import { readApiJson } from "../api-client.js";
import { compassHistoryPath } from "../compass-routing.js";
import { escapeHtml } from "../shared/html.js";

const timezone = "Asia/Tokyo";
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validStamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const storageKey = (projectId, actionId) => `project-schedule:${projectId}:${actionId}`;

export function safeProjectCalendarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function projectScheduleCalendar(draft) {
  if (
    !record(draft) ||
    typeof draft.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    !Number.isFinite(Date.parse(`${draft.date}T00:00:00Z`)) ||
    new Date(`${draft.date}T00:00:00Z`).toISOString().slice(0, 10) !== draft.date ||
    typeof draft.allDay !== "boolean"
  )
    return null;
  if (
    !draft.allDay &&
    (![draft.startTime, draft.endTime].every(
      (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value),
    ) ||
      draft.endTime <= draft.startTime)
  )
    return null;
  return {
    allDay: draft.allDay,
    date: draft.date,
    startTime: draft.allDay ? null : draft.startTime,
    endTime: draft.allDay ? null : draft.endTime,
    timeZone: timezone,
  };
}

function validPending(value, actionId) {
  return (
    record(value) &&
    value.actionId === actionId &&
    uuid(value.requestId) &&
    validStamp(value.actionUpdatedAt) &&
    validStamp(value.projectUpdatedAt) &&
    typeof value.content === "string" &&
    value.content.trim().length > 0 &&
    value.content.length <= 500 &&
    value.calendar?.timeZone === timezone &&
    Boolean(projectScheduleCalendar(value.calendar))
  );
}
function normalizeOperation(value, projectId, actionId) {
  if (value === null) return null;
  if (
    !record(value) ||
    value.actionId !== actionId ||
    value.projectId !== projectId ||
    !uuid(value.requestId) ||
    !validPending({ ...value, calendar: value.calendar }, actionId) ||
    !["planned", "calendar_created", "todo_created", "linked"].includes(value.stage) ||
    (value.todoId !== null && !positiveId(value.todoId)) ||
    (["todo_created", "linked"].includes(value.stage) && !positiveId(value.todoId))
  ) {
    throw new Error("保存済みの予定作成情報を確認できませんでした。結果を再確認してください。");
  }
  return {
    ...value,
    calendar: projectScheduleCalendar(value.calendar),
    calendarUrl: safeProjectCalendarUrl(value.calendarUrl),
  };
}
const draftFromCalendar = (content, calendar) => ({
  content,
  date: calendar.date,
  allDay: calendar.allDay,
  startTime: calendar.startTime || "09:00",
  endTime: calendar.endTime || "10:00",
});
function readDraft(storage, projectId, actionId) {
  try {
    const raw = storage?.getItem(storageKey(projectId, actionId));
    if (!raw || raw.length > 20000) return null;
    const value = JSON.parse(raw);
    if (
      !record(value) ||
      !record(value.draft) ||
      typeof value.draft.content !== "string" ||
      value.draft.content.length > 500 ||
      typeof value.draft.date !== "string" ||
      typeof value.draft.allDay !== "boolean" ||
      typeof value.draft.startTime !== "string" ||
      typeof value.draft.endTime !== "string" ||
      (value.pending !== null && !validPending(value.pending, actionId))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
async function requestJson(url, init) {
  const response = await fetch(url, init);
  const payload = await readApiJson(response);
  if (!response.ok) {
    const error = new Error(
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || "予定作成の結果を確認できませんでした。",
    );
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** Stateful logic is independent of the dialog so failures/revisits can be tested. */
export function createProjectScheduleController({
  project,
  action,
  refreshProject,
  storage,
  request = requestJson,
  randomUUID = () => crypto.randomUUID(),
  onChange = () => {},
}) {
  const saved = readDraft(storage, project.id, action.id);
  const state = {
    project,
    action,
    draft: saved?.draft || {
      content: action.content,
      date: action.startOn || action.dueOn || "",
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
    },
    pending: saved?.pending || null,
    operation: null,
    checked: false,
    busy: false,
    consent: false,
    needsRefresh: false,
    refreshed: false,
    resultUnknown: Boolean(saved?.pending),
    error: "",
    blocked: false,
  };
  const notify = () => onChange(state);
  const persist = () => {
    try {
      storage?.setItem(
        storageKey(project.id, action.id),
        JSON.stringify({ draft: state.draft, pending: state.pending }),
      );
    } catch {
      /* In-memory intent still protects retries if browser storage is unavailable. */
    }
  };
  const clear = () => {
    try {
      storage?.removeItem(storageKey(project.id, action.id));
    } catch {
      /* The server operation remains authoritative. */
    }
  };
  const incompatible = () =>
    Boolean(
      state.pending &&
      (state.pending.actionUpdatedAt !== state.action.updatedAt ||
        state.pending.projectUpdatedAt !== state.project.updatedAt),
    );
  const adopt = (operation) => {
    state.operation = operation;
    if (!operation) return;
    state.draft = draftFromCalendar(operation.content, operation.calendar);
    state.pending = {
      actionId: action.id,
      actionUpdatedAt: operation.actionUpdatedAt,
      projectUpdatedAt: operation.projectUpdatedAt,
      requestId: operation.requestId,
      content: operation.content,
      calendar: operation.calendar,
    };
    state.needsRefresh = operation.stage !== "linked" && incompatible();
    persist();
  };
  const locked = () => Boolean(state.pending || state.operation);
  const controller = {
    state,
    locked,
    setDraft(draft) {
      if (state.busy || locked()) return;
      state.draft = { ...state.draft, ...draft };
      state.consent = false;
      persist();
      notify();
    },
    setConsent(value) {
      if (!state.busy) {
        state.consent = value === true;
        notify();
      }
    },
    async load() {
      if (state.busy) return false;
      state.busy = true;
      state.checked = false;
      state.error = "";
      state.consent = false;
      notify();
      try {
        const payload = await request(`/api/project-schedule?actionId=${action.id}`, {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!record(payload) || !("operation" in payload))
          throw new Error("保存済みの予定作成情報を確認できませんでした。");
        adopt(normalizeOperation(payload.operation, project.id, action.id));
        state.checked = true;
        state.resultUnknown = Boolean(
          state.pending && (!state.operation || state.operation.stage === "planned"),
        );
        state.needsRefresh = incompatible() && state.operation?.stage !== "linked";
        if (state.operation?.stage === "linked") clear();
        return true;
      } catch (error) {
        state.error = error.message || "予定作成の結果を確認できませんでした。";
        state.resultUnknown = Boolean(state.pending);
        return false;
      } finally {
        state.busy = false;
        notify();
      }
    },
    async refresh() {
      if (state.busy) return false;
      state.busy = true;
      state.error = "";
      state.consent = false;
      notify();
      try {
        const fresh = await refreshProject(project.id);
        const freshAction =
          fresh?.actions?.find((entry) => entry.id === action.id) ||
          (fresh?.nextAction?.id === action.id ? fresh.nextAction : null);
        if (
          !fresh ||
          fresh.id !== project.id ||
          !validStamp(fresh.updatedAt) ||
          !freshAction ||
          !validStamp(freshAction.updatedAt)
        )
          throw new Error("最新のActionを取得できませんでした。");
        state.project = fresh;
        state.action = freshAction;
        state.refreshed = true;
        state.needsRefresh = false;
        state.blocked =
          ["completed", "dropped"].includes(fresh.status) ||
          !["next", "queued", "waiting"].includes(freshAction.status) ||
          Boolean(freshAction.linkedTodo);
        if (state.blocked)
          state.error = freshAction.linkedTodo
            ? "このActionは既にToDoと紐づいています。既存のToDoを確認してください。"
            : "このProjectまたはActionは終了済みです。作成済みの予定・ToDoを確認してください。";
        // Snapshot changes become eligible only after this explicit refresh and
        // the user's NEW confirmation checkbox. They are not posted here.
        return !state.blocked;
      } catch (error) {
        state.error = error.message || "最新状態を取得できませんでした。";
        state.needsRefresh = true;
        return false;
      } finally {
        state.busy = false;
        notify();
      }
    },
    async submit() {
      if (
        state.busy ||
        !state.checked ||
        state.needsRefresh ||
        state.blocked ||
        state.operation?.stage === "linked"
      )
        return false;
      if (!state.consent) {
        state.error = "表示した内容とGoogle Calendarへの作成を確認してください。";
        notify();
        return false;
      }
      const calendar = projectScheduleCalendar(state.draft);
      const content = state.draft.content.trim();
      if (!calendar || !content || content.length > 500) {
        state.error = "内容・日付・開始終了時刻を確認してください。";
        notify();
        return false;
      }
      if (!state.pending)
        state.pending = {
          actionId: action.id,
          actionUpdatedAt: state.action.updatedAt,
          projectUpdatedAt: state.project.updatedAt,
          requestId: randomUUID(),
          content,
          calendar,
        };
      else if (state.refreshed)
        state.pending = {
          ...state.pending,
          actionUpdatedAt: state.action.updatedAt,
          projectUpdatedAt: state.project.updatedAt,
        };
      state.busy = true;
      state.error = "";
      state.resultUnknown = true;
      persist();
      notify();
      try {
        const payload = await request("/api/project-schedule", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Dashboard-Action": "project-schedule-create",
          },
          body: JSON.stringify(state.pending),
        });
        const operation = normalizeOperation(payload?.operation, project.id, action.id);
        if (!operation) throw new Error("予定作成の結果が不明です。保存結果を確認してください。");
        adopt(operation);
        state.resultUnknown = false;
        state.refreshed = false;
        if (operation.stage !== "linked") {
          state.error = "予定作成は途中です。保存済みの内容を確認して再開してください。";
          return false;
        }
        clear();
        return true;
      } catch (error) {
        const payload = error.payload;
        if (record(payload) && "operation" in payload) {
          try {
            adopt(normalizeOperation(payload.operation, project.id, action.id));
          } catch {
            state.checked = false;
          }
        } else state.checked = false;
        if (state.operation?.stage === "linked") {
          state.resultUnknown = false;
          clear();
          return true;
        }
        state.resultUnknown = payload?.resultUnknown !== false;
        state.error = error.message || "予定作成の結果が不明です。保存結果を確認してください。";
        if (
          [
            "ACTION_CONFLICT",
            "PROJECT_CONFLICT",
            "PROJECT_NOT_OPEN",
            "TODO_ALREADY_LINKED",
            "TODO_CONFLICT",
          ].includes(payload?.error?.code)
        )
          state.needsRefresh = true;
        state.consent = false;
        persist();
        return false;
      } finally {
        state.busy = false;
        notify();
      }
    },
  };
  if (state.pending) state.draft = draftFromCalendar(state.pending.content, state.pending.calendar);
  state.needsRefresh = incompatible();
  return controller;
}

const stageLabels = {
  planned: "予定内容を保存済み・Calendarの結果を確認",
  calendar_created: "Calendar作成済み・ToDo保存を再開",
  todo_created: "Calendar・ToDo作成済み・紐づけを再開",
  linked: "Calendar・ToDoの作成と紐づけが完了",
};
const statusLabels = {
  active: "進行中",
  waiting: "確認待ち",
  on_hold: "保留",
  completed: "完了",
  dropped: "終了",
  next: "Next Action",
  queued: "候補",
  done: "完了",
  cancelled: "取消",
};
export function projectScheduleLinks(state) {
  const todoId = state.operation?.todoId;
  const currentTodoId = state.action?.linkedTodo?.id;
  const links = [];
  if (positiveId(todoId))
    links.push({ href: compassHistoryPath("todos", todoId), label: "作成済みToDoを確認" });
  if (positiveId(currentTodoId) && currentTodoId !== todoId)
    links.push({
      href: compassHistoryPath("todos", currentTodoId),
      label: "現在紐づいているToDoを確認",
    });
  const calendarUrl = safeProjectCalendarUrl(state.operation?.calendarUrl);
  if (calendarUrl) links.push({ href: calendarUrl, label: "Calendarの予定を確認" });
  return links;
}

export async function openProjectSchedule({ project, action, refreshProject, showToast }) {
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "project-todo-dialog";
  dialog.setAttribute("aria-labelledby", "projectScheduleTitle");
  dialog.innerHTML = `<header><h2 id="projectScheduleTitle">Actionの予定を作成</h2><button type="button" data-close aria-label="閉じる">×</button></header><div data-body></div>`;
  document.body.append(dialog);
  let storage;
  try {
    storage = window.sessionStorage;
  } catch {
    /* Browser may block storage. */
  }
  let controller;
  const body = dialog.querySelector("[data-body]");
  const close = () => {
    if (!controller.state.busy) dialog.close();
  };
  const render = (state) => {
    if (!dialog.isConnected) return;
    const locked = controller.locked();
    const done = state.operation?.stage === "linked";
    const draft = state.draft;
    const links = projectScheduleLinks(state);
    body.innerHTML = `<form class="project-todo-form">
      <p class="project-todo-preview">${escapeHtml(state.project.title)}（${escapeHtml(statusLabels[state.project.status] || state.project.status)}）<br>Action: ${escapeHtml(state.action.content)}（${escapeHtml(statusLabels[state.action.status] || state.action.status)}）</p>
      ${state.operation ? `<p role="status">${escapeHtml(stageLabels[state.operation.stage])}</p>` : state.pending ? '<p role="status">送信済みの内容を保持しています。結果を確認して同じ予定作成を再開します。</p>' : ""}
      ${state.resultUnknown ? '<p role="status">作成結果の一部は未確認です。同じ予定の結果を確認し、重複を防ぎます。</p>' : ""}
      ${links.length ? `<p>${links.map((link) => `<a href="${escapeHtml(link.href)}"${link.href.startsWith("https:") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`).join("<br>")}</p>` : ""}
      <label>予定の内容<textarea name="content" rows="2" maxlength="500" required ${locked || state.busy ? "disabled" : ""}>${escapeHtml(draft.content)}</textarea></label>
      <label>日付<input name="date" type="date" required value="${escapeHtml(draft.date)}" ${locked || state.busy ? "disabled" : ""}></label>
      <fieldset class="project-todo-resolution"><legend>時間（Asia/Tokyo）</legend><label><input name="allDay" type="checkbox" ${draft.allDay ? "checked" : ""} ${locked || state.busy ? "disabled" : ""}>終日</label>
        <div ${draft.allDay ? "hidden" : ""}><label>開始<input name="startTime" type="time" value="${escapeHtml(draft.startTime)}" ${locked || state.busy ? "disabled" : ""}></label><label>終了<input name="endTime" type="time" value="${escapeHtml(draft.endTime)}" ${locked || state.busy ? "disabled" : ""}></label></div></fieldset>
      ${locked && !done ? "<p>保存済みの内容と日時を保持して再開します。作成済みのToDo・Calendarは削除しません。</p>" : ""}
      ${!done ? `<p>保存するとGoogle Calendarに予定を1件作成し、ToDoをこのActionに紐づけます。Actionは完了にしません。</p><fieldset class="project-todo-resolution"><legend>保存前の確認</legend><label><input name="consent" type="checkbox" ${state.consent ? "checked" : ""} ${state.busy || state.needsRefresh || state.blocked ? "disabled" : ""}>表示した${state.refreshed ? "最新のProject・Actionと" : ""}内容・日時・タイムゾーンと、Calendarへの作成を確認しました</label></fieldset>` : ""}
      <p role="alert" class="form-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error)}</p>
      ${!state.checked || state.resultUnknown ? `<button type="button" data-check ${state.busy ? "disabled" : ""}>保存結果を確認</button>` : ""}
      ${!done && (state.pending || state.error) ? `<button type="button" data-refresh ${state.busy ? "disabled" : ""}>最新Project・Actionを取得して確認</button>` : ""}
      <footer><button type="button" data-cancel ${state.busy ? "disabled" : ""}>${done ? "閉じる" : "キャンセル"}</button>${!done ? `<button type="submit" class="primary" ${state.busy || !state.checked || state.needsRefresh || state.blocked || !state.consent ? "disabled" : ""}>${state.busy ? "結果を確認中…" : locked ? "同じ予定作成を再開" : "Calendarに作成して紐づける"}</button>` : ""}</footer></form>`;
    dialog.querySelector("[data-close]").disabled = state.busy;
    const form = body.querySelector("form");
    for (const name of ["content", "date", "startTime", "endTime"]) {
      form.elements[name].addEventListener("input", (event) => {
        // Avoid replacing a focused control on every keystroke.
        if (controller.locked() || controller.state.busy) return;
        controller.state.draft[name] = event.target.value;
        controller.state.consent = false;
        try {
          storage?.setItem(
            storageKey(project.id, action.id),
            JSON.stringify({ draft: controller.state.draft, pending: null }),
          );
        } catch {
          /* Keep in memory. */
        }
        const consent = form.elements.consent;
        if (consent) consent.checked = false;
        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.disabled = true;
      });
    }
    form.elements.allDay.addEventListener("change", (event) =>
      controller.setDraft({ allDay: event.target.checked }),
    );
    form.elements.consent?.addEventListener("change", (event) =>
      controller.setConsent(event.target.checked),
    );
    form.querySelector("[data-cancel]").addEventListener("click", close);
    form.querySelector("[data-check]")?.addEventListener("click", () => {
      void controller.load();
    });
    form.querySelector("[data-refresh]")?.addEventListener("click", () => {
      void controller.refresh();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(await controller.submit())) return;
      dialog.close();
      try {
        const refreshed = await refreshProject(project.id);
        if (!refreshed) throw new Error("refresh unavailable");
        showToast("Calendar予定とToDoを作成し、Actionに紐づけました。");
      } catch {
        showToast("予定と紐づけは保存済みです。Projectの最新表示を再読み込みしてください。");
      }
    });
  };
  controller = createProjectScheduleController({
    project,
    action,
    refreshProject,
    storage,
    onChange: render,
  });
  dialog.querySelector("[data-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    if (controller.state.busy) event.preventDefault();
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (previous?.isConnected) previous.focus();
    },
    { once: true },
  );
  dialog.showModal();
  render(controller.state);
  await controller.load();
}
