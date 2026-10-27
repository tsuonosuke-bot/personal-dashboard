import { createProjectState, projectsElements } from "./projects/state.js";
import { projectRequest as rawProjectRequest } from "./projects/api.js";
import { escapeHtml } from "./shared/html.js";
import { createProjectModel } from "./projects/model.js";
import { createProjectView } from "./projects/view.js";
import {
  nextActionResolution,
  openProjectTodoLink,
  unlinkProjectTodo,
} from "./shared/project-todo-link.js";
import {
  createCaptureRequest,
  readCaptureDraft,
  saveCaptureDraft,
  mergeReviewActions,
} from "./projects/goals.js";
import { openProjectHabits } from "./projects/habits.js";
import { openProjectSchedule } from "./projects/schedule.js";

const state = createProjectState();
const els = projectsElements(document);

function projectRequest(url, init, errorFactory) {
  if (init?.method && init.method !== "GET") {
    const target = new URL(url, window.location.origin);
    for (const [name, value] of Object.entries({
      view: state.view,
      q: state.search,
      sort: state.sort,
      attention: String(state.attentionOnly),
    }))
      target.searchParams.set(name, value);
    url = `${target.pathname}${target.search}`;
  }
  return rawProjectRequest(url, init, errorFactory);
}

function showToast(message) {
  els.toast.textContent = state.savedRefreshError
    ? `${message} ${state.savedRefreshError}`
    : message;
  state.savedRefreshError = null;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3_500);
}

function setFormError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

function setData(payload) {
  if (payload?.saved && payload.refreshError) {
    state.savedRefreshError = payload.refreshError;
    return;
  }
  if (!payload || !Array.isArray(payload.projects) || typeof payload.summary !== "object") {
    throw new Error("Projectデータの形式が正しくありません。");
  }
  if (payload.partial && state.data) {
    if (state.view === "review")
      for (const project of payload.projects) {
        const previous = state.data.projects.find((entry) => entry.id === project.id);
        project.reviewActions = mergeReviewActions(previous, project);
      }
    const updates = new Map(payload.projects.map((project) => [project.id, project]));
    state.data.projects = state.data.projects.map((project) => updates.get(project.id) || project);
    for (const project of payload.projects)
      if (!state.data.projects.some((entry) => entry.id === project.id))
        state.data.projects.push(project);
    state.data.summary = payload.summary;
    state.data.source = payload.source;
    if (state.data.page && Number.isSafeInteger(payload.page?.contextTotal))
      state.data.page.total = payload.page.contextTotal;
  } else state.data = payload;
  if (payload.source) {
    const partial = payload.source.state === "partial";
    els.sourceBadge.textContent = partial ? "一部取得不可" : "SUPABASE LIVE";
    els.sourceBadge.className = `source-badge ${partial ? "partial" : "live"}`;
  }
  renderAll();
}

async function loadGoalStatus(projects) {
  const goals = {},
    errors = {};
  for (let index = 0; index < projects.length; index += 100) {
    const ids = projects.slice(index, index + 100).map((project) => project.id);
    try {
      const payload = await projectRequest(
        `/api/project-goals?ids=${ids.join(",")}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
        (payload) => new Error(payload.error || "目標の確認情報を取得できませんでした。"),
      );
      if (!Array.isArray(payload.goals)) throw new Error("目標の確認情報を取得できませんでした。");
      for (const id of ids) {
        const goal = payload.goals.find((entry) => entry.projectId === id);
        if (!goal) throw new Error("対象の目標情報が見つかりません。再読み込みしてください。");
        goals[id] = goal;
      }
    } catch (error) {
      for (const id of ids) errors[id] = error.message || "目標の確認情報を取得できませんでした。";
    }
  }
  return { goals, errors };
}

function applyGoalStatus(result, ids) {
  for (const id of ids) {
    delete state.goals[id];
    delete state.goalErrors[id];
    if (result.goals[id]) state.goals[id] = result.goals[id];
    if (result.errors[id]) state.goalErrors[id] = result.errors[id];
  }
}

function setView(view, attentionOnly = false) {
  state.view = view;
  state.attentionOnly = attentionOnly;
  if (view === "review") {
    state.search = "";
    els.searchInput.value = "";
  }
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  void loadProjects({ skipRoute: true });
}

let projectLoadGeneration = 0;
async function loadProjects(options = {}) {
  const generation = ++projectLoadGeneration;
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.projectList.hidden = true;
  try {
    const params = new URLSearchParams({
      view: state.view,
      q: state.search,
      sort: state.sort,
      attention: String(state.attentionOnly),
      offset: String(options.append ? state.data?.projects.length || 0 : 0),
    });
    let payload = await projectRequest(
      `/api/projects?${params}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
      (payload) =>
        new Error(
          typeof payload.error === "string" ? payload.error : "Projectを読み込めませんでした。",
        ),
    );
    const goalStatus = await loadGoalStatus(payload.projects || []);
    if (state.view === "review")
      payload = await projectRequest(
        `/api/projects?${params}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
        (payload) => new Error(payload.error || "Projectを読み込めませんでした。"),
      );
    if (generation !== projectLoadGeneration) return false;
    applyGoalStatus(
      goalStatus,
      (payload.projects || []).map((project) => project.id),
    );
    if (options.append && state.data)
      payload.projects = [...state.data.projects, ...payload.projects];
    setData(payload);
    els.sourceBadge.textContent =
      payload.source?.state === "partial" ? "一部取得不可" : "SUPABASE LIVE";
    els.sourceBadge.className = `source-badge ${payload.source?.state === "partial" ? "partial" : "live"}`;
    els.loadingState.hidden = true;
    els.projectList.hidden = false;
    if (!options.skipRoute) void applyRoute(false);
    return true;
  } catch (error) {
    if (generation !== projectLoadGeneration) return false;
    els.sourceBadge.textContent = "接続エラー";
    els.sourceBadge.className = "source-badge error";
    els.loadingState.hidden = true;
    els.errorMessage.textContent =
      error instanceof Error ? error.message : "Projectを読み込めませんでした。";
    els.errorState.hidden = false;
    return false;
  } finally {
    if (generation === projectLoadGeneration) els.refreshButton.disabled = false;
  }
}

async function fetchProjectDetail(id, options = {}) {
  const context = JSON.stringify([state.view, state.search, state.sort, state.attentionOnly]);
  // Bind review to a token taken BEFORE the displayed data. Any intervening
  // semantic edit invalidates POST, rather than blessing unseen newer content.
  const goalStatus = await loadGoalStatus([{ id: Number(id) }]);
  const params = new URLSearchParams({
    id: String(id),
    historyOffset: String(options.historyOffset || 0),
    itemOffset: String(options.itemOffset || 0),
    view: state.view,
    q: state.search,
    sort: state.sort,
    attention: String(state.attentionOnly),
  });
  const payload = await projectRequest(`/api/projects?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (context !== JSON.stringify([state.view, state.search, state.sort, state.attentionOnly]))
    return fetchProjectDetail(id, options);
  const project = payload.projects?.[0];
  if (!project) throw new Error("対象のProjectが見つかりません。");
  if (context !== JSON.stringify([state.view, state.search, state.sort, state.attentionOnly]))
    return fetchProjectDetail(id, options);
  applyGoalStatus(goalStatus, [project.id]);
  const previous = getProject(id);
  if (options.append && previous) {
    const history = previous.actions.filter((action) =>
      ["done", "cancelled"].includes(action.status),
    );
    project.actions = [
      ...new Map([...history, ...project.actions].map((action) => [action.id, action])).values(),
    ];
    project.items = [
      ...new Map([...previous.items, ...project.items].map((item) => [item.id, item])).values(),
    ];
  }
  setData(payload);
  return getProject(id);
}

async function loadMoreDetail(project, kind, all = false) {
  try {
    let fresh = project;
    do {
      const historyOffset =
        kind === "history"
          ? Number(fresh.page.historyOffset) + 10
          : Number(fresh.page.historyOffset);
      const itemOffset =
        kind === "items" ? Number(fresh.page.itemOffset) + 50 : Number(fresh.page.itemOffset);
      fresh = await fetchProjectDetail(project.id, { historyOffset, itemOffset, append: true });
    } while (all && fresh.page[kind === "history" ? "historyHasMore" : "itemsHasMore"]);
    if (state.selectedId === project.id) renderDetail(fresh);
    return true;
  } catch (error) {
    showToast(error.message || "詳細を取得できませんでした。再試行してください。");
    return false;
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

function applyRoute(_notify = true) {
  const id = routeProjectId();
  if (id === null) return;
  const project = getProject(id);
  void openDetail(project || { id }, false);
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
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
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
    const payload = await projectRequest(
      "/api/projects",
      {
        method: project ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": project ? "project-update" : "project-create",
        },
        body: JSON.stringify(body),
      },
      (payload) => new Error(payload.error || "Projectを保存できませんでした。"),
    );
    setData(payload);
    closeProjectEditor();
    if (project) openDetail(getProject(project.id), false);
    showToast(project ? "Projectを更新しました。" : "Projectと最初のNext Actionを作成しました。");
  } catch (error) {
    setFormError(
      els.projectFormError,
      error instanceof Error ? error.message : "Projectを保存できませんでした。",
    );
  } finally {
    els.projectSave.disabled = false;
    els.projectCancel.disabled = false;
  }
}

async function openDetail(project, updateRoute = true) {
  if (!project) return;
  if (state.selectedId !== project.id) state.completedShown = COMPLETED_PAGE;
  if (state.selectedId !== project.id) state.editingActionId = null;
  if (state.selectedId !== project.id) state.editingMilestoneId = null;
  state.selectedId = project.id;
  if (!state.captureDrafts[project.id])
    state.captureDrafts[project.id] = readCaptureDraft(window.sessionStorage, project.id) || {
      content: "",
      pending: null,
    };
  els.detailModal.hidden = false;
  document.body.style.overflow = "hidden";
  if (updateRoute) window.history.pushState(null, "", routePath(project.id));
  if (project.detailLoaded) {
    renderDetail(project);
    return;
  }
  els.detailTitle.textContent = project.title || "Project";
  els.detailBody.innerHTML = '<p role="status">詳細を読み込んでいます…</p>';
  try {
    const fresh = await fetchProjectDetail(project.id);
    if (state.selectedId === project.id) renderDetail(fresh);
  } catch (error) {
    if (state.selectedId !== project.id) return;
    els.detailBody.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p><button type="button" id="retryProjectDetail">再試行</button>`;
    document
      .getElementById("retryProjectDetail")
      .addEventListener("click", () => openDetail({ id: project.id }, false));
  }
}

function closeDetail(updateRoute = true) {
  els.detailModal.hidden = true;
  state.selectedId = null;
  if (els.projectModal.hidden && els.resolveModal.hidden) document.body.style.overflow = "";
  if (updateRoute) window.history.pushState(null, "", routePath());
}

async function saveProjectAction(event, projectId, operation = "capture") {
  event.preventDefault();
  const project = getProject(projectId);
  const form = event.currentTarget;
  const input = form.querySelector(
    operation === "resume" ? "#detailResumeInput" : "#detailActionInput",
  );
  const errorElement = form.nextElementSibling;
  const submit = form.querySelector("button[type=submit]");
  if (!project || !input?.value.trim()) return;
  submit.disabled = true;
  setFormError(errorElement, "");
  if (operation === "capture") {
    const draft = state.captureDrafts[project.id] || { content: input.value, pending: null };
    draft.content = input.value;
    draft.pending ||= createCaptureRequest(project, input.value, crypto.randomUUID());
    state.captureDrafts[project.id] = draft;
    saveCaptureDraft(window.sessionStorage, project.id, draft);
    input.readOnly = true;
    let saved = false;
    try {
      await projectRequest(
        "/api/project-goals",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Dashboard-Action": "project-goal-update",
          },
          body: JSON.stringify(draft.pending),
        },
        (payload) =>
          Object.assign(new Error(payload.error || "保存結果を確認できませんでした。"), {
            canRebase: payload.canRebase === true,
          }),
      );
      saved = true;
      state.captureDrafts[project.id] = { content: "", pending: null };
      saveCaptureDraft(window.sessionStorage, project.id, null);
      input.value = "";
      const fresh = await fetchProjectDetail(project.id);
      if (state.selectedId === project.id) renderDetail(fresh);
      showToast("Action候補を追加しました。");
    } catch (error) {
      draft.error = saved
        ? "保存は完了しました。最新状態を再読み込みしてください。"
        : `${error.message} 同じ内容で保存結果を確認できます。`;
      if (error.canRebase) {
        draft.canRebase = true;
        saveCaptureDraft(window.sessionStorage, project.id, draft);
        if (state.selectedId === project.id) renderDetail(getProject(project.id));
      }
      const visibleError =
        state.selectedId === project.id
          ? els.detailBody.querySelector("#detailActionError")
          : errorElement;
      if (visibleError) setFormError(visibleError, draft.error);
      submit.textContent = saved ? "候補に追加" : "同じ内容で保存結果を確認";
      input.readOnly = !saved;
    } finally {
      submit.disabled = false;
    }
    return;
  }
  try {
    const payload = await projectRequest(
      "/api/project-actions",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-action-create",
        },
        body: JSON.stringify({
          operation: "resume",
          projectId: project.id,
          content: input.value,
          originalProjectUpdatedAt: project.updatedAt,
        }),
      },
      (payload) => new Error(payload.error || "Actionを保存できませんでした。"),
    );
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    await fetchProjectDetail(project.id);
    showToast("Next Actionを設定してProjectを再開しました。");
  } catch (error) {
    setFormError(
      errorElement,
      error instanceof Error ? error.message : "Actionを保存できませんでした。",
    );
  } finally {
    submit.disabled = false;
  }
}

async function markProjectReviewed(projectId, button) {
  const project = getProject(projectId),
    goal = state.goals[projectId];
  if (!project || !goal || project.updatedAt !== goal.projectUpdatedAt) {
    showToast("最新状態を再読み込みして確認してください。");
    return;
  }
  button.disabled = true;
  let saved = false;
  try {
    state.reviewRequests ||= {};
    const previous = state.reviewRequests[projectId];
    const request =
      previous?.fingerprint === goal.fingerprint
        ? previous
        : {
            operation: "review",
            requestId: crypto.randomUUID(),
            projectId,
            projectUpdatedAt: project.updatedAt,
            fingerprint: goal.fingerprint,
          };
    state.reviewRequests[projectId] = request;
    await projectRequest(
      "/api/project-goals",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-goal-update",
        },
        body: JSON.stringify(request),
      },
      (payload) => new Error(payload.error || "レビューを保存できませんでした。"),
    );
    saved = true;
    delete state.reviewRequests[projectId];
    const fresh = await fetchProjectDetail(projectId);
    if (state.selectedId === projectId) renderDetail(fresh);
    showToast("レビューを記録しました。");
  } catch (error) {
    showToast(saved ? "レビューは保存済みです。最新状態を再読み込みしてください。" : error.message);
  } finally {
    button.disabled = false;
  }
}

async function refreshProjectConnections(projectId) {
  const fresh = await fetchProjectDetail(projectId);
  if (state.selectedId === projectId) renderDetail(fresh);
  return fresh;
}

async function refreshCapture(projectId) {
  const draft = state.captureDrafts[projectId];
  if (!draft?.canRebase) return;
  try {
    const fresh = await fetchProjectDetail(projectId);
    draft.pending = null;
    draft.canRebase = false;
    draft.error = "";
    saveCaptureDraft(window.sessionStorage, projectId, draft);
    if (state.selectedId === projectId) renderDetail(fresh);
    showToast("最新状態を表示しました。内容を確認してから追加してください。");
  } catch (error) {
    showToast(error.message);
  }
}

const actionToasts = {
  edit: "Actionを保存しました。",
  complete: "Actionを完了しました。",
  cancel: "Actionを取り消しました。",
  pin: "Next Actionにしました。",
};

async function updateAction(
  projectId,
  actionId,
  operation,
  fields = { content: null, dueOn: null, startOn: null },
) {
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
  controls.forEach((control) => {
    control.disabled = true;
  });
  if (errorElement) setFormError(errorElement, "");
  try {
    const payload = await projectRequest(
      "/api/project-actions",
      {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-action-update",
        },
        body: JSON.stringify({
          actionId,
          originalUpdatedAt: action.updatedAt,
          operation,
          ...fields,
          ...(action.linkedTodo
            ? {
                todo: {
                  id: action.linkedTodo.id,
                  updatedAt: action.linkedTodo.updatedAt,
                  status: action.linkedTodo.status,
                },
              }
            : {}),
        }),
      },
      (payload) => new Error(payload.error || "Actionを更新できませんでした。"),
    );
    if (operation === "edit" || operation === "cancel") state.editingActionId = null;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    if (actionToasts[operation]) showToast(actionToasts[operation]);
  } catch (error) {
    controls.forEach((control) => {
      control.disabled = false;
    });
    if (errorElement)
      setFormError(
        errorElement,
        error instanceof Error ? error.message : "Actionを更新できませんでした。",
      );
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

async function updateMilestone(
  projectId,
  milestoneId,
  operation,
  fields = { title: null, dueOn: null },
) {
  const project = getProject(projectId);
  const milestone = project?.milestones.find((candidate) => candidate.id === milestoneId) || null;
  const key = milestoneId === null ? "new" : milestoneId;
  const errorElement = els.detailBody.querySelector(`[data-milestone-error="${key}"]`);
  if (!project || (milestoneId !== null && !milestone)) return;
  const scope = els.detailBody.querySelector(
    milestoneId === null ? '[data-milestone-form="new"]' : `[data-milestone-row="${milestoneId}"]`,
  );
  const controls = scope?.querySelectorAll("button, input") || [];
  controls.forEach((control) => {
    control.disabled = true;
  });
  if (errorElement) setFormError(errorElement, "");
  try {
    const payload = await projectRequest(
      "/api/project-milestones",
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-milestone-update",
        },
        body: JSON.stringify({
          projectId,
          originalProjectUpdatedAt: project.updatedAt,
          milestoneId,
          originalUpdatedAt: milestone?.updatedAt ?? null,
          operation,
          ...fields,
        }),
      },
      (payload) => new Error(payload.error || "マイルストンを更新できませんでした。"),
    );
    if (["create", "edit", "delete"].includes(operation)) state.editingMilestoneId = null;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    if (milestoneToasts[operation]) showToast(milestoneToasts[operation]);
  } catch (error) {
    controls.forEach((control) => {
      control.disabled = false;
    });
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
  const contents = String(data.get("contents") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!project) return;
  if (!contents.length) {
    setFormError(errorElement, "追加するタスクを1行以上入力してください。");
    return;
  }
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  setFormError(errorElement, "");
  try {
    const payload = await projectRequest(
      "/api/project-actions",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-action-create",
        },
        body: JSON.stringify({
          operation: "addBulk",
          projectId,
          contents,
          milestoneId: Number(data.get("milestoneId")) || null,
          originalProjectUpdatedAt: project.updatedAt,
        }),
      },
      (payload) => new Error(payload.error || "タスクを追加できませんでした。"),
    );
    state.bulkOpen = false;
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    showToast(`${contents.length}件のタスクを追加しました。`);
  } catch (error) {
    setFormError(
      errorElement,
      error instanceof Error ? error.message : "タスクを追加できませんでした。",
    );
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
  controls.forEach((control) => {
    control.disabled = true;
  });
  setFormError(errorElement, "");
  try {
    const payload = await projectRequest(
      "/api/project-items",
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-item-process",
        },
        body: JSON.stringify({
          itemId: item.id,
          originalItemUpdatedAt: item.updatedAt,
          originalProjectUpdatedAt: project.updatedAt,
          treatment,
          actionContent,
        }),
      },
      (payload) => new Error(payload.error || "関連アイテムを整理できませんでした。"),
    );
    setData(payload);
    const fresh = getProject(project.id);
    if (fresh) renderDetail(fresh);
    const message =
      treatment === "action_source"
        ? "関連アイテムをActionにしました。"
        : treatment === "reference"
          ? "関連アイテムを参考情報にしました。"
          : "関連アイテムを対象外にしました。";
    showToast(message);
  } catch (error) {
    setFormError(
      errorElement,
      error instanceof Error ? error.message : "関連アイテムを整理できませんでした。",
    );
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
}

function updateResolveFields() {
  const resolution = new FormData(els.resolveForm).get("resolution");
  els.continueFields.hidden = resolution !== "continue";
  els.waitingFields.hidden = resolution !== "waiting";
  els.holdFields.hidden = resolution !== "on_hold";
  els.newNextActionField.hidden = Boolean(els.queuedActionSelect.value);
}

async function openResolve(project, terminal = "done") {
  if (!project) return;
  if (!project.detailLoaded) {
    try {
      project = await fetchProjectDetail(project.id);
    } catch (error) {
      showToast(error.message || "Projectを読み込めませんでした。");
      return;
    }
  }
  if (!project.nextAction) return;
  state.resolveProjectId = project.id;
  state.resolveTerminal = terminal;
  els.completedActionText.textContent = `${terminal === "cancelled" ? "見送り" : "完了"}: ${project.nextAction.content}`;
  const queued = project.actions.filter((action) => action.status === "queued");
  els.queuedActionSelect.innerHTML =
    '<option value="">新しく入力する</option>' +
    queued
      .map((action) => `<option value="${action.id}">${escapeHtml(action.content)}</option>`)
      .join("");
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
    ...nextActionResolution(
      resolution,
      queuedActionId,
      els.newNextActionInput.value,
      els.waitingForInput.value,
      resolution === "waiting" ? els.waitingReviewInput.value : els.holdReviewInput.value,
    ),
    ...(project.nextAction.linkedTodo
      ? {
          todo: {
            id: project.nextAction.linkedTodo.id,
            updatedAt: project.nextAction.linkedTodo.updatedAt,
            status: project.nextAction.linkedTodo.status,
          },
        }
      : {}),
    ...(state.resolveTerminal === "cancelled" ? { terminal: "cancelled" } : {}),
  };
  els.resolveSave.disabled = true;
  els.resolveCancel.disabled = true;
  setFormError(els.resolveFormError, "");
  try {
    const payload = await projectRequest(
      "/api/project-actions",
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "project-action-resolve",
        },
        body: JSON.stringify(body),
      },
      (payload) => new Error(payload.error || "Actionを完了できませんでした。"),
    );
    setData(payload);
    closeResolve();
    const fresh = getProject(project.id);
    if (fresh && !els.detailModal.hidden) renderDetail(fresh);
    if (!fresh || fresh.status === "completed") closeDetail();
    showToast(
      resolution === "complete"
        ? "Projectを完了しました。"
        : "Actionを完了し、Projectの次の状態を保存しました。",
    );
  } catch (error) {
    setFormError(
      els.resolveFormError,
      error instanceof Error ? error.message : "Actionを完了できませんでした。",
    );
  } finally {
    els.resolveSave.disabled = false;
    els.resolveCancel.disabled = false;
  }
}

async function refreshProjectTodoLink(projectId) {
  const loaded = await loadProjects();
  const project = getProject(projectId);
  if (loaded && project) renderDetail(project);
  showToast(
    loaded
      ? "ToDoとの紐づけを更新しました。"
      : "紐づけは保存済みです。最新表示を再読み込みしてください。",
  );
}
function openActionTodo(projectId, actionId) {
  const project = getProject(projectId);
  const action = project?.actions.find((item) => item.id === actionId);
  if (action)
    void openProjectTodoLink({
      project,
      action,
      onSuccess: () => refreshProjectTodoLink(projectId),
    });
}
async function unlinkActionTodo(projectId, actionId) {
  const action = getProject(projectId)?.actions.find((item) => item.id === actionId);
  if (!action?.linkedTodo) return;
  try {
    await unlinkProjectTodo(action, action.linkedTodo, () => refreshProjectTodoLink(projectId));
  } catch (error) {
    showToast(error.message || "紐づけを解除できませんでした。");
  }
}

const {
  completedDate,
  displayDate,
  futureDate,
  todayTokyo,
  dayDiff,
  getProject,
  projectsForView,
  COMPLETED_PAGE,
  STALE_DAYS,
  sortProjects,
  staleDays,
  reviewData,
} = createProjectModel({
  state,
});

const { renderAll, renderDetail } = createProjectView({
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
  markProjectReviewed: (...args) => markProjectReviewed(...args),
  saveCaptureDraft: (projectId, draft) => saveCaptureDraft(window.sessionStorage, projectId, draft),
  refreshCapture: (...args) => refreshCapture(...args),
  openProjectHabits: (project) =>
    openProjectHabits({ project, refreshProject: refreshProjectConnections, showToast }),
  openProjectSchedule: (project, action) =>
    openProjectSchedule({ project, action, refreshProject: refreshProjectConnections, showToast }),
  updateAction: (...args) => updateAction(...args),
  updateMilestone: (...args) => updateMilestone(...args),
  saveBulkActions: (...args) => saveBulkActions(...args),
  processRelatedItem: (...args) => processRelatedItem(...args),
  openActionTodo: (...args) => openActionTodo(...args),
  unlinkActionTodo: (...args) => unlinkActionTodo(...args),
  loadMoreDetail: (...args) => loadMoreDetail(...args),
});

els.addProjectButton.addEventListener("click", () => openProjectEditor());
els.refreshButton.addEventListener("click", loadProjects);
els.retryButton.addEventListener("click", loadProjects);
let projectSearchTimer;
els.searchInput.addEventListener("input", () => {
  state.search = els.searchInput.value;
  clearTimeout(projectSearchTimer);
  projectSearchTimer = setTimeout(() => loadProjects({ skipRoute: true }), 200);
});
els.sortSelect.addEventListener("change", () => {
  state.sort = els.sortSelect.value;
  void loadProjects({ skipRoute: true });
});
els.clearFilters.addEventListener("click", () => {
  state.search = "";
  state.attentionOnly = false;
  els.searchInput.value = "";
  void loadProjects({ skipRoute: true });
});
document
  .querySelectorAll("[data-view]")
  .forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
document
  .querySelectorAll("[data-summary-view]")
  .forEach((button) => button.addEventListener("click", () => setView(button.dataset.summaryView)));
document
  .querySelector("[data-summary-filter=attention]")
  .addEventListener("click", () => setView("active", true));
els.projectList.addEventListener("click", (event) => {
  const review = event.target.closest("[data-review-mark]");
  if (review) {
    void markProjectReviewed(Number(review.dataset.reviewMark), review);
    return;
  }
  if (event.target.closest("[data-projects-more]")) {
    void loadProjects({ append: true, skipRoute: true });
    return;
  }
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
els.resolveForm
  .querySelectorAll('input[name="resolution"]')
  .forEach((radio) => radio.addEventListener("change", updateResolveFields));
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
