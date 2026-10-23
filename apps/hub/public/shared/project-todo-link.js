import { escapeHtml } from "./html.js";
import { requestApiJson } from "../api-client.js";

const todoLabels = { pending: "未実施", completed: "完了", skipped: "見送り" };
const actionLabels = { next: "Next Action", queued: "あとで行う", waiting: "確認待ち", done: "完了", cancelled: "取り消し" };
export function actionStatusForTodo(todoStatus, actionStatus) {
  return todoStatus === "completed" ? "done" : todoStatus === "skipped" ? "cancelled"
    : ["next", "queued", "waiting"].includes(actionStatus) ? actionStatus : "queued";
}
export function nextActionResolution(resolution, nextActionId, nextActionContent, waitingFor, reviewOn) {
  return {
    resolution,
    nextActionId: resolution === "continue" ? Number(nextActionId) || null : null,
    nextActionContent: resolution === "continue" && !nextActionId ? String(nextActionContent || "").trim() || null : null,
    waitingFor: resolution === "waiting" ? String(waitingFor || "").trim() || null : null,
    reviewOn: ["waiting", "on_hold"].includes(resolution) ? reviewOn || null : null,
  };
}
function resolutionFields(project) {
  const queued = project.actions.filter((action) => action.status === "queued");
  return `<fieldset class="project-todo-resolution"><legend>このNext Actionを終えた後は？</legend>
    <label><input type="radio" name="resolution" value="continue" checked> 続ける — 次のActionを決める</label>
    <label><input type="radio" name="resolution" value="complete"> 目標を達成した — Projectを完了</label>
    <label><input type="radio" name="resolution" value="waiting"> 相手・結果を待つ</label>
    <label><input type="radio" name="resolution" value="on_hold"> いったん保留する</label>
    <div data-resolution="continue"><label>次のAction<select name="nextActionId"><option value="">新しく入力する</option>${queued.map((action) => `<option value="${action.id}">${escapeHtml(action.content)}</option>`).join("")}</select></label><label data-new-next>新しいNext Action<textarea name="nextActionContent" maxlength="500" rows="2"></textarea></label></div>
    <div data-resolution="waiting" hidden><label>待っている相手・内容<input name="waitingFor" maxlength="240"></label><label>再確認日<input name="reviewOn" type="date"></label></div>
    <div data-resolution="on_hold" hidden><label>見直し日<input name="holdReviewOn" type="date"></label></div>
  </fieldset>`;
}
function wireResolution(form) {
  const fields = form.querySelector(".project-todo-resolution");
  if (!fields) return;
  const sync = () => {
    const data = new FormData(form);
    fields.querySelectorAll("[data-resolution]").forEach((row) => { row.hidden = row.dataset.resolution !== data.get("resolution"); });
    fields.querySelector("[data-new-next]").hidden = Boolean(data.get("nextActionId"));
  };
  fields.addEventListener("change", sync);
  sync();
}
function readResolution(form) {
  const data = new FormData(form);
  const kind = data.get("resolution");
  const value = nextActionResolution(kind, data.get("nextActionId"), data.get("nextActionContent"), data.get("waitingFor"), data.get(kind === "on_hold" ? "holdReviewOn" : "reviewOn"));
  if (kind === "continue" && !value.nextActionId && !value.nextActionContent) throw new Error("次のActionを選ぶか入力してください。");
  if (kind === "waiting" && (!value.waitingFor || !value.reviewOn)) throw new Error("待っている相手・内容と再確認日を入力してください。");
  if (kind === "on_hold" && !value.reviewOn) throw new Error("見直し日を入力してください。");
  return value;
}
function createDialog(title) {
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "project-todo-dialog";
  dialog.setAttribute("aria-labelledby", "projectTodoDialogTitle");
  dialog.innerHTML = `<header><h2 id="projectTodoDialogTitle">${title}</h2><button type="button" data-dialog-close aria-label="閉じる">×</button></header><div data-dialog-body><p role="status">読み込み中…</p></div>`;
  document.body.append(dialog);
  let busy = false;
  const close = () => dialog.close();
  dialog.querySelector("[data-dialog-close]").addEventListener("click", () => { if (!busy) close(); });
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); if (previous?.isConnected) previous.focus(); }, { once: true });
  dialog.showModal();
  return { dialog, body: dialog.querySelector("[data-dialog-body]"), close, setBusy: (value) => { busy = value; } };
}
async function linkCandidates() {
  const payload = await requestApiJson("/api/project-action-todos", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!Array.isArray(payload.projects) || !Array.isArray(payload.todos)) throw new Error("紐づけ候補を読み込めませんでした。");
  return payload;
}
export function projectTodoSnapshot(action, todo) {
  return { actionId: action.id, actionUpdatedAt: action.updatedAt, todoId: todo.id, todoUpdatedAt: todo.updatedAt, todoStatus: todo.status };
}
export async function requestProjectTodoLink(method, body) {
  return requestApiJson("/api/project-action-todos", { method, credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-todo-link" }, body: JSON.stringify(body) },
  (payload) => new Error(payload.error || "紐づけを変更できませんでした。"));
}

/** One selector/preview is used from either screen; titles never infer a link. */
export async function openProjectTodoLink({ todo = null, action = null, project = null, onSuccess }) {
  const { dialog, body, close, setBusy } = createDialog("ToDoとProjectタスクを紐づける");
  try {
    const data = await linkCandidates();
    if (!dialog.isConnected) return;
    const projects = data.projects.filter((item) => !["completed", "dropped"].includes(item.status));
    const fixedTodoId = todo?.id;
    const fixedActionId = action?.id;
    let projectId = project?.id || null;
    let actionId = fixedActionId || null;
    let todoId = fixedTodoId || null;
    const render = () => {
      const selectedProject = projects.find((item) => item.id === Number(projectId));
      const actions = (selectedProject?.actions || []).filter((item) => !item.linkedTodo || item.linkedTodo.id === Number(todoId));
      if (!actions.some((item) => item.id === Number(actionId))) actionId = fixedActionId || null;
      const todos = data.todos.filter((item) => !item.linkedProjectAction || item.linkedProjectAction.id === Number(actionId));
      if (!todos.some((item) => item.id === Number(todoId))) todoId = fixedTodoId || null;
      const selectedAction = actions.find((item) => item.id === Number(actionId));
      const selectedTodo = todos.find((item) => item.id === Number(todoId));
      const needsResolution = selectedAction?.status === "next" && Boolean(selectedTodo) && selectedTodo.status !== "pending";
      body.innerHTML = `<form class="project-todo-form">
        <label>Project<select name="project" ${fixedActionId ? "disabled" : ""}><option value="">選択してください</option>${projects.map((item) => `<option value="${item.id}"${item.id === Number(projectId) ? " selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></label>
        <label>Projectタスク<select name="action" ${fixedActionId ? "disabled" : ""}><option value="">選択してください</option>${actions.map((item) => `<option value="${item.id}"${item.id === Number(actionId) ? " selected" : ""}>${escapeHtml(item.content)}（${actionLabels[item.status]}）</option>`).join("")}</select></label>
        <label>ToDo<select name="todo" ${fixedTodoId ? "disabled" : ""}><option value="">選択してください</option>${todos.map((item) => `<option value="${item.id}"${item.id === Number(todoId) ? " selected" : ""}>${escapeHtml(item.title)} · ${escapeHtml(item.schedule.date)}（${todoLabels[item.status]}）</option>`).join("")}</select></label>
        ${selectedAction && selectedTodo ? `<p class="project-todo-preview">「${escapeHtml(selectedAction.content)}」を「${escapeHtml(selectedTodo.title)}」と紐づけます。<br>タスクの状態: ${actionLabels[selectedAction.status]} → ${actionLabels[actionStatusForTodo(selectedTodo.status, selectedAction.status)]}<br>日時: ${escapeHtml(selectedTodo.schedule.date)}${selectedTodo.schedule.allDay ? " 終日" : ` ${escapeHtml(selectedTodo.schedule.startTime)}〜${escapeHtml(selectedTodo.schedule.endTime)}`}</p>` : '<p>同じ行動を表すProjectタスクとToDoを選んでください。</p>'}
        ${needsResolution && selectedProject ? resolutionFields(selectedProject) : ""}
        <p>ToDoとCalendarの予定は追加せず、既存の2件を紐づけます。</p>
        <p class="form-error" role="alert" hidden></p><footer><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary" ${!selectedAction || !selectedTodo ? "disabled" : ""}>紐づける</button></footer></form>`;
      const form = body.querySelector("form");
      form.querySelector('[name="project"]').addEventListener("change", (event) => { projectId = Number(event.target.value); actionId = null; render(); });
      form.querySelector('[name="action"]').addEventListener("change", (event) => { actionId = Number(event.target.value); render(); });
      form.querySelector('[name="todo"]').addEventListener("change", (event) => { todoId = Number(event.target.value); render(); });
      form.querySelector("[data-cancel]").addEventListener("click", close);
      wireResolution(form);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const error = form.querySelector('[role="alert"]');
        const controls = form.querySelectorAll("button,select,input,textarea");
        try {
          const resolution = needsResolution ? readResolution(form) : null;
          controls.forEach((control) => { control.disabled = true; });
          setBusy(true);
          await requestProjectTodoLink("POST", { ...projectTodoSnapshot(selectedAction, selectedTodo), resolution });
          close();
          await onSuccess?.();
        } catch (failure) {
          setBusy(false);
          error.textContent = failure.message || "紐づけを保存できませんでした。"; error.hidden = false;
          controls.forEach((control) => { control.disabled = false; });
          form.querySelector('[name="project"]').disabled = Boolean(fixedActionId);
          form.querySelector('[name="action"]').disabled = Boolean(fixedActionId);
          form.querySelector('[name="todo"]').disabled = Boolean(fixedTodoId);
        }
      });
    };
    render();
  } catch (failure) { if (dialog.isConnected) body.textContent = failure.message || "候補を読み込めませんでした。"; }
}

export async function unlinkProjectTodo(action, todo, onSuccess) {
  const start = action.storedStartOn ?? null;
  const due = action.storedDueOn ?? null;
  if (!window.confirm(`紐づけを解除しますか？両方の記録とCalendar予定は残ります。\n解除後のProjectの日付: 着手 ${start || "未設定"} / 期日 ${due || "未設定"}`)) return;
  await requestProjectTodoLink("DELETE", projectTodoSnapshot(action, todo));
  await onSuccess?.();
}

export async function chooseTodoNextResolution(link, command, onConfirm) {
  const { dialog, body, close, setBusy } = createDialog(command === "skip" ? "見送り後のProjectを決める" : "完了後のProjectを決める");
  let data;
  try { data = await linkCandidates(); }
  catch (error) { close(); throw error; }
  if (!dialog.isConnected) return null;
  const project = data.projects.find((item) => item.id === link.projectId);
  const action = project?.actions.find((item) => item.id === link.id);
  if (!action || action.updatedAt !== link.updatedAt || action.status !== "next") { close(); throw new Error("Projectタスクが変更されています。再読み込みしてください。"); }
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(null), { once: true });
    body.innerHTML = `<form class="project-todo-form"><p>${escapeHtml(project.title)} / ${escapeHtml(action.content)}</p>${resolutionFields(project)}<p class="form-error" role="alert" hidden></p><footer><button type="button" data-cancel>キャンセル</button><button class="primary" type="submit">${command === "skip" ? "見送り" : "完了"}を確定</button></footer></form>`;
    const form = body.querySelector("form");
    wireResolution(form);
    form.querySelector("[data-cancel]").addEventListener("click", close);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const controls = form.querySelectorAll("button,input,select,textarea");
      try {
        const result = readResolution(form);
        controls.forEach((control) => { control.disabled = true; });
        setBusy(true);
        if (onConfirm) await onConfirm(result);
        resolve(result); close();
      } catch (failure) {
        setBusy(false);
        controls.forEach((control) => { control.disabled = false; });
        const error = form.querySelector('[role="alert"]'); error.textContent = failure.message; error.hidden = false;
      }
    });
  });
}
