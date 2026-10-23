import { createProjectState, projectsElements } from "./projects/state.js";
import { projectRequest } from "./projects/api.js";
import { escapeHtml } from "./shared/html.js";
import { createProjectModel } from "./projects/model.js";
import { createProjectView } from "./projects/view.js";

const state = createProjectState();
const els = projectsElements(document);

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 3_500);
}

function setFormError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}


function setData(payload) {
  if (!payload || !Array.isArray(payload.projects) || typeof payload.summary !== "object") {
    throw new Error("Projectデータの形式が正しくありません。");
  }
  state.data = payload;
  renderAll();
}

function setView(view, attentionOnly = false) {
  state.view = view;
  state.attentionOnly = attentionOnly;
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  renderList();
}

async function loadProjects() {
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.projectList.hidden = true;
  try {
    const payload = await projectRequest("/api/projects", { headers: { Accept: "application/json" }, cache: "no-store" },
      (payload) => new Error(typeof payload.error === "string" ? payload.error : "Projectを読み込めませんでした。"));
    setData(payload);
    els.sourceBadge.textContent = "SUPABASE LIVE";
    els.sourceBadge.className = "source-badge live";
    els.loadingState.hidden = true;
    els.projectList.hidden = false;
    applyRoute(false);
    return true;
  } catch (error) {
    els.sourceBadge.textContent = "接続エラー";
    els.sourceBadge.className = "source-badge error";
    els.loadingState.hidden = true;
    els.errorMessage.textContent = error instanceof Error ? error.message : "Projectを読み込めませんでした。";
    els.errorState.hidden = false;
    return false;
  } finally {
    els.refreshButton.disabled = false;
  }
}

function routeProjectId() {
  const value = new URL(window.location.href).searchParams.get("id");
  if (value === null) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : -1;
}

function routePath(id = null) {
  return id ? `/projects/?id=${id}` : "/projects/";
}

function applyRoute(notify = true) {
  const id = routeProjectId();
  if (id === null) return;
  const project = getProject(id);
  if (!project) {
    window.history.replaceState(null, "", routePath());
    if (notify) showToast("対象のProjectが見つかりません。一覧を表示します。");
    return;
  }
  openDetail(project, false);
}

function openProjectEditor(project = null) {
  state.editorMode = project ? "edit" : "create";
  state.selectedId = project?.id || state.selectedId;
  els.projectEditorKicker.textContent = project ? "EDIT PROJECT" : "NEW PROJECT";
  els.projectEditorTitle.textContent = project ? "Projectを編集" : "Projectを作成";
  els.projectTitleInput.value = project?.title || "";
  els.projectOutcomeInput.value = project?.outcome || "";
  els.projectThemeInput.value = project?.theme || "";
  els.projectTargetInput.value = project?.targetOn || "";
  els.projectNextActionInput.value = "";
  els.projectNextActionField.hidden = Boolean(project);
  els.projectNextActionInput.required = !project;
  els.projectFormHint.textContent = project
    ? "状態とNext ActionはProject詳細から変更します。"
    : "Active Projectには、作成時からNext Actionを1件設定します。";
  els.projectSave.textContent = project ? "保存" : "作成";
  setFormError(els.projectFormError, "");
  els.projectModal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => els.projectTitleInput.focus(), 0);
}

function closeProjectEditor() {
  els.projectModal.hidden = true;
  if (els.detailModal.hidden) document.body.style.overflow = "";
  const url = new URL(window.location.href);
  if (url.searchParams.get("new") === "project") {
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

async function saveProject(event) {
  event.preventDefault();
  const project = state.editorMode === "edit" ? getProject(state.selectedId) : null;
  if (state.editorMode === "edit" && !project) return;
  const body = project
    ? {
      id: project.id,
      title: els.projectTitleInput.value,
      outcome: els.projectOutcomeInput.value,
      theme: els.projectThemeInput.value || null,
      targetOn: els.projectTargetInput.value || null,
      originalUpdatedAt: project.updatedAt,
    }
    : {
      title: els.projectTitleInput.value,
      outcome: els.projectOutcomeInput.value,
      theme: els.projectThemeInput.value || null,
      targetOn: els.projectTargetInput.value || null,
      nextAction: els.projectNextActionInput.value,
    };
  els.projectSave.disabled = true;
  els.projectCancel.disabled = true;
  setFormError(els.projectFormError, "");
  try {
    const payload = await projectRequest("/api/projects", {
      method: project ? "PATCH" : "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": project ? "project-update" : "project-create",
      },
      body: JSON.stringify(body),
    }, (payload) => new Error(payload.error || "Projectを保存できませんでした。"));
    setData(payload);
    closeProjectEditor();
    if (project) openDetail(getProject(project.id), false);
    showToast(project ? "Projectを更新しました。" : "Projectと最初のNext Actionを作成しました。");
  } catch (error) {
    setFormError(els.projectFormError, error instanceof Error ? error.message : "Projectを保存できませんでした。");
  } finally {
    els.projectSave.disabled = false;
    els.projectCancel.disabled = false;
  }
}

function openDetail(project, updateRoute = true) {
  if (!project) return;
  if (state.selectedId !== project.id) state.completedShown = COMPLETED_PAGE;
  if (state.selectedId !== project.id) state.editingActionId = null;
  if (state.selectedId !== project.id) state.editingMilestoneId = null;
  state.selectedId = project.id;
  renderDetail(project);
  els.detailModal.hidden = false;
  document.body.style.overflow = "hidden";
  if (updateRoute) window.history.pushState(null, "", routePath(project.id));
}

function closeDetail(updateRoute = true) {
  els.detailModal.hidden = true;
  state.selectedId = null;
  if (els.projectModal.hidden && els.resolveModal.hidden) document.body.style.overflow = "";
  if (updateRoute) window.history.pushState(null, "", routePath());
}

async function saveProjectAction(event, projectId) {
  event.preventDefault();
  const project = getProject(projectId);
  const form = event.currentTarget;
  const input = form.querySelector("#detailActionInput");
  const errorElement = form.nextElementSibling;
  const submit = form.querySelector("button[type=submit]");
  if (!project || !input?.value.trim()) return;
  submit.disabled = true;
  setFormError(errorElement, "");
  try {
    const payload = await projectRequest("/api/project-actions", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-create" },
      body: JSON.stringify({
        operation: project.status === "active" ? "addQueued" : "resume",
        projectId: project.id,
        content: input.value,
        originalProjectUpdatedAt: project.updatedAt,
      }),
    }, (payload) => new Error(payload.error || "Actionを保存できませんでした。"));
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    showToast(project.status === "active" ? "Action候補を追加しました。" : "Next Actionを設定してProjectを再開しました。");
  } catch (error) {
    setFormError(errorElement, error instanceof Error ? error.message : "Actionを保存できませんでした。");
  } finally {
    submit.disabled = false;
  }
}

const actionToasts = {
  edit: "Actionを保存しました。",
  complete: "Actionを完了しました。",
  cancel: "Actionを取り消しました。",
  pin: "Next Actionにしました。",
};

async function updateAction(projectId, actionId, operation, fields = { content: null, dueOn: null, startOn: null }) {
  const project = getProject(projectId);
  const action = project?.actions.find((candidate) => candidate.id === actionId);
  const row = els.detailBody.querySelector(`[data-action-row="${actionId}"]`);
  const errorElement = row?.querySelector(`[data-action-error="${actionId}"]`);
  if (!project || !action || !row) return;
  if (operation === "edit" && fields.startOn && fields.dueOn && fields.startOn > fields.dueOn) {
    if (errorElement) setFormError(errorElement, "着手日は期日より前の日付にしてください。");
    return;
  }
  const controls = row.querySelectorAll("button, input");
  controls.forEach((control) => { control.disabled = true; });
  if (errorElement) setFormError(errorElement, "");
  try {
    const payload = await projectRequest("/api/project-actions", {
      method: "PUT",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-update" },
      body: JSON.stringify({ actionId, originalUpdatedAt: action.updatedAt, operation, ...fields }),
    }, (payload) => new Error(payload.error || "Actionを更新できませんでした。"));
    if (operation === "edit" || operation === "cancel") state.editingActionId = null;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    if (actionToasts[operation]) showToast(actionToasts[operation]);
  } catch (error) {
    controls.forEach((control) => { control.disabled = false; });
    if (errorElement) setFormError(errorElement, error instanceof Error ? error.message : "Actionを更新できませんでした。");
    else showToast(error instanceof Error ? error.message : "Actionを更新できませんでした。");
  }
}

const milestoneToasts = {
  create: "マイルストンを追加しました。",
  edit: "マイルストンを保存しました。",
  complete: "マイルストンを達成にしました。",
  reopen: "マイルストンを再開しました。",
  delete: "マイルストンを削除しました。タスクは残っています。",
};

async function updateMilestone(projectId, milestoneId, operation, fields = { title: null, dueOn: null }) {
  const project = getProject(projectId);
  const milestone = project?.milestones.find((candidate) => candidate.id === milestoneId) || null;
  const key = milestoneId === null ? "new" : milestoneId;
  const errorElement = els.detailBody.querySelector(`[data-milestone-error="${key}"]`);
  if (!project || (milestoneId !== null && !milestone)) return;
  const scope = els.detailBody.querySelector(milestoneId === null ? '[data-milestone-form="new"]' : `[data-milestone-row="${milestoneId}"]`);
  const controls = scope?.querySelectorAll("button, input") || [];
  controls.forEach((control) => { control.disabled = true; });
  if (errorElement) setFormError(errorElement, "");
  try {
    const payload = await projectRequest("/api/project-milestones", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-milestone-update" },
      body: JSON.stringify({
        projectId,
        originalProjectUpdatedAt: project.updatedAt,
        milestoneId,
        originalUpdatedAt: milestone?.updatedAt ?? null,
        operation,
        ...fields,
      }),
    }, (payload) => new Error(payload.error || "マイルストンを更新できませんでした。"));
    if (["create", "edit", "delete"].includes(operation)) state.editingMilestoneId = null;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    if (milestoneToasts[operation]) showToast(milestoneToasts[operation]);
  } catch (error) {
    controls.forEach((control) => { control.disabled = false; });
    const message = error instanceof Error ? error.message : "マイルストンを更新できませんでした。";
    if (errorElement) setFormError(errorElement, message);
    else showToast(message);
  }
}

async function saveBulkActions(event, projectId) {
  event.preventDefault();
  const project = getProject(projectId);
  const form = event.currentTarget;
  const errorElement = form.querySelector("#bulkAddError");
  const data = new FormData(form);
  const contents = String(data.get("contents") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!project) return;
  if (!contents.length) {
    setFormError(errorElement, "追加するタスクを1行以上入力してください。");
    return;
  }
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  setFormError(errorElement, "");
  try {
    const payload = await projectRequest("/api/project-actions", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-create" },
      body: JSON.stringify({
        operation: "addBulk",
        projectId,
        contents,
        milestoneId: Number(data.get("milestoneId")) || null,
        originalProjectUpdatedAt: project.updatedAt,
      }),
    }, (payload) => new Error(payload.error || "タスクを追加できませんでした。"));
    state.bulkOpen = false;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    showToast(`${contents.length}件のタスクを追加しました。`);
  } catch (error) {
    setFormError(errorElement, error instanceof Error ? error.message : "タスクを追加できませんでした。");
    submit.disabled = false;
  }
}

async function processRelatedItem(projectId, itemId, treatment, actionContent) {
  const project = getProject(projectId);
  const item = project?.items.find((candidate) => candidate.id === itemId);
  const row = els.detailBody.querySelector(`[data-project-item-row="${itemId}"]`);
  const errorElement = row?.querySelector(`[data-project-item-error="${itemId}"]`);
  const controls = row?.querySelectorAll("button, input") || [];
  if (!project || !item || item.treatment !== "unprocessed" || !row || !errorElement) return;
  controls.forEach((control) => { control.disabled = true; });
  setFormError(errorElement, "");
  try {
    const payload = await projectRequest("/api/project-items", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-item-process" },
      body: JSON.stringify({
        itemId: item.id,
        originalItemUpdatedAt: item.updatedAt,
        originalProjectUpdatedAt: project.updatedAt,
        treatment,
        actionContent,
      }),
    }, (payload) => new Error(payload.error || "関連アイテムを整理できませんでした。"));
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    const message = treatment === "action_source"
      ? "関連アイテムをActionにしました。"
      : treatment === "reference" ? "関連アイテムを参考情報にしました。" : "関連アイテムを対象外にしました。";
    showToast(message);
  } catch (error) {
    setFormError(errorElement, error instanceof Error ? error.message : "関連アイテムを整理できませんでした。");
    controls.forEach((control) => { control.disabled = false; });
  }
}

function updateResolveFields() {
  const resolution = new FormData(els.resolveForm).get("resolution");
  els.continueFields.hidden = resolution !== "continue";
  els.waitingFields.hidden = resolution !== "waiting";
  els.holdFields.hidden = resolution !== "on_hold";
  els.newNextActionField.hidden = Boolean(els.queuedActionSelect.value);
}

function openResolve(project) {
  if (!project.nextAction) return;
  state.resolveProjectId = project.id;
  els.completedActionText.textContent = `完了: ${project.nextAction.content}`;
  const queued = project.actions.filter((action) => action.status === "queued");
  els.queuedActionSelect.innerHTML = '<option value="">新しく入力する</option>'
    + queued.map((action) => `<option value="${action.id}">${escapeHtml(action.content)}</option>`).join("");
  // 候補があれば、並べ替えた先頭を次のNext Actionとして選んでおく（#154）。
  els.queuedActionSelect.value = queued[0] ? String(queued[0].id) : "";
  els.newNextActionInput.value = "";
  els.waitingForInput.value = "";
  els.waitingReviewInput.value = futureDate(7);
  els.holdReviewInput.value = futureDate(30);
  els.resolveForm.querySelector('input[value="continue"]').checked = true;
  setFormError(els.resolveFormError, "");
  updateResolveFields();
  els.resolveModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeResolve() {
  els.resolveModal.hidden = true;
  state.resolveProjectId = null;
  if (els.detailModal.hidden && els.projectModal.hidden) document.body.style.overflow = "";
}

async function resolveAction(event) {
  event.preventDefault();
  const project = getProject(state.resolveProjectId);
  if (!project?.nextAction) return;
  const resolution = new FormData(els.resolveForm).get("resolution");
  const queuedActionId = els.queuedActionSelect.value ? Number(els.queuedActionSelect.value) : null;
  const body = {
    actionId: project.nextAction.id,
    originalUpdatedAt: project.nextAction.updatedAt,
    resolution,
    nextActionId: resolution === "continue" ? queuedActionId : null,
    nextActionContent: resolution === "continue" && !queuedActionId ? els.newNextActionInput.value || null : null,
    waitingFor: resolution === "waiting" ? els.waitingForInput.value || null : null,
    reviewOn: resolution === "waiting"
      ? els.waitingReviewInput.value || null
      : resolution === "on_hold" ? els.holdReviewInput.value || null : null,
  };
  els.resolveSave.disabled = true;
  els.resolveCancel.disabled = true;
  setFormError(els.resolveFormError, "");
  try {
    const payload = await projectRequest("/api/project-actions", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-resolve" },
      body: JSON.stringify(body),
    }, (payload) => new Error(payload.error || "Actionを完了できませんでした。"));
    setData(payload);
    closeResolve();
    const fresh = getProject(project.id);
    if (fresh && !els.detailModal.hidden) renderDetail(fresh);
    if (!fresh || fresh.status === "completed") closeDetail();
    showToast(resolution === "complete" ? "Projectを完了しました。" : "Actionを完了し、Projectの次の状態を保存しました。");
  } catch (error) {
    setFormError(els.resolveFormError, error instanceof Error ? error.message : "Actionを完了できませんでした。");
  } finally {
    els.resolveSave.disabled = false;
    els.resolveCancel.disabled = false;
  }
}

const { completedDate, displayDate, futureDate, todayTokyo, dayDiff, getProject, projectsForView, COMPLETED_PAGE, STALE_DAYS, sortProjects, staleDays, reviewData } = createProjectModel({
  state
});

const { renderList, renderAll, renderDetail } = createProjectView({
  displayDate: (...args) => displayDate(...args),
  dayDiff: (...args) => dayDiff(...args),
  staleDays: (...args) => staleDays(...args),
  todayTokyo: (...args) => todayTokyo(...args),
  state,
  els,
  reviewData: (...args) => reviewData(...args),
  STALE_DAYS,
  sortProjects: (...args) => sortProjects(...args),
  projectsForView: (...args) => projectsForView(...args),
  getProject: (...args) => getProject(...args),
  closeDetail: (...args) => closeDetail(...args),
  completedDate: (...args) => completedDate(...args),
  COMPLETED_PAGE,
  openProjectEditor: (...args) => openProjectEditor(...args),
  openResolve: (...args) => openResolve(...args),
  saveProjectAction: (...args) => saveProjectAction(...args),
  updateAction: (...args) => updateAction(...args),
  updateMilestone: (...args) => updateMilestone(...args),
  saveBulkActions: (...args) => saveBulkActions(...args),
  processRelatedItem: (...args) => processRelatedItem(...args)
});

els.addProjectButton.addEventListener("click", () => openProjectEditor());
els.refreshButton.addEventListener("click", loadProjects);
els.retryButton.addEventListener("click", loadProjects);
els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; renderList(); });
els.sortSelect.addEventListener("change", () => { state.sort = els.sortSelect.value; renderList(); });
els.clearFilters.addEventListener("click", () => {
  state.search = "";
  state.attentionOnly = false;
  els.searchInput.value = "";
  renderList();
});
document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
document.querySelectorAll("[data-summary-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.summaryView)));
document.querySelector("[data-summary-filter=attention]").addEventListener("click", () => setView("active", true));
els.projectList.addEventListener("click", (event) => {
  const detail = event.target.closest("[data-detail]");
  const resolve = event.target.closest("[data-resolve]");
  if (detail) openDetail(getProject(detail.dataset.detail));
  if (resolve) openResolve(getProject(resolve.dataset.resolve));
});
els.projectForm.addEventListener("submit", saveProject);
els.projectBackdrop.addEventListener("click", closeProjectEditor);
els.projectClose.addEventListener("click", closeProjectEditor);
els.projectCancel.addEventListener("click", closeProjectEditor);
els.detailBackdrop.addEventListener("click", () => closeDetail());
els.detailClose.addEventListener("click", () => closeDetail());
els.resolveBackdrop.addEventListener("click", closeResolve);
els.resolveClose.addEventListener("click", closeResolve);
els.resolveCancel.addEventListener("click", closeResolve);
els.resolveForm.addEventListener("submit", resolveAction);
els.resolveForm.querySelectorAll('input[name="resolution"]').forEach((radio) => radio.addEventListener("change", updateResolveFields));
els.queuedActionSelect.addEventListener("change", updateResolveFields);
window.addEventListener("popstate", () => {
  const id = routeProjectId();
  if (id && id > 0) applyRoute();
  else if (!els.detailModal.hidden) closeDetail(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.resolveModal.hidden) closeResolve();
  else if (!els.projectModal.hidden) closeProjectEditor();
  else if (!els.detailModal.hidden) closeDetail();
});

const openNewProjectOnLoad = new URLSearchParams(window.location.search).get("new") === "project";
loadProjects().then((loaded) => {
  if (loaded && openNewProjectOnLoad) openProjectEditor();
});
