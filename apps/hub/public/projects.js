import { readApiJson } from "./api-client.js";

const state = {
  data: null,
  view: "active",
  attentionOnly: false,
  search: "",
  sort: "recommended",
  /** 詳細で表示中の完了Actionの件数。Projectを開き直すと先頭10件に戻す。 */
  completedShown: 10,
  selectedId: null,
  editorMode: "create",
  resolveProjectId: null,
  /** 詳細で編集フォームを開いているActionのID（#153）。 */
  editingActionId: null,
  /** 詳細で編集フォームを開いているマイルストンのID（#161）。 */
  editingMilestoneId: null,
  /** 「まとめて追加」を開いたままにするか。 */
  bulkOpen: false,
};

const ids = [
  "sourceBadge", "refreshButton", "addProjectButton", "activeCount", "attentionCount", "waitingCount", "completedCount",
  "activeTabCount", "waitingTabCount", "completedTabCount", "reviewTabCount", "filtersBar", "resultLine", "searchInput", "sortSelect", "sortNote", "clearFilters", "resultCount",
  "loadingState", "errorState", "errorMessage", "retryButton", "projectList",
  "projectModal", "projectBackdrop", "projectClose", "projectCancel", "projectForm", "projectEditorKicker", "projectEditorTitle",
  "projectTitleInput", "projectOutcomeInput", "projectThemeInput", "projectTargetInput", "projectNextActionField",
  "projectNextActionInput", "projectFormHint", "projectFormError", "projectSave",
  "detailModal", "detailBackdrop", "detailClose", "detailKicker", "detailTitle", "detailBody",
  "resolveModal", "resolveBackdrop", "resolveClose", "resolveCancel", "resolveForm", "completedActionText",
  "continueFields", "queuedActionSelect", "newNextActionField", "newNextActionInput", "waitingFields",
  "waitingForInput", "waitingReviewInput", "holdFields", "holdReviewInput", "resolveFormError", "resolveSave", "toast",
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const statusLabels = {
  active: "進行中",
  waiting: "確認待ち",
  on_hold: "保留",
  completed: "完了",
  dropped: "終了",
};

const treatmentLabels = {
  unprocessed: "未整理",
  reference: "参考情報",
  action_source: "Action化済み",
  rejected: "不採用",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function completedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

function displayDate(value) {
  if (!value) return "未設定";
  const [year, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayTokyo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function dayDiff(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Actionの着手日・期日を短いチップにする。期限超過・3日以内・着手日到来を色で分ける（#153）。 */
function actionDateChips(action, today) {
  const chips = [];
  if (action.startOn) {
    const ready = action.startOn <= today;
    chips.push(`<span class="date-chip${ready ? " start-ready" : ""}">着手 ${displayDate(action.startOn)}</span>`);
  }
  if (action.dueOn) {
    const days = dayDiff(today, action.dueOn);
    const tone = days < 0 ? " overdue" : days <= 3 ? " soon" : "";
    const note = days < 0 ? `${-days}日超過` : days === 0 ? "今日" : `あと${days}日`;
    chips.push(`<span class="date-chip${tone}">期日 ${displayDate(action.dueOn)}（${note}）</span>`);
  }
  return chips.length ? `<span class="date-chips">${chips.join("")}</span>` : "";
}

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

function getProject(id) {
  return state.data?.projects.find((project) => project.id === Number(id)) || null;
}

function setData(payload) {
  if (!payload || !Array.isArray(payload.projects) || typeof payload.summary !== "object") {
    throw new Error("Projectデータの形式が正しくありません。");
  }
  state.data = payload;
  renderAll();
}

function projectsForView() {
  if (!state.data) return [];
  const query = state.search.trim().toLocaleLowerCase("ja");
  return state.data.projects.filter((project) => {
    const viewMatches = state.view === "active"
      ? project.status === "active"
      : state.view === "waiting"
        ? project.status === "waiting" || project.status === "on_hold"
        : project.status === "completed" || project.status === "dropped";
    if (!viewMatches || (state.attentionOnly && !project.needsAttention)) return false;
    if (!query) return true;
    const actionText = project.actions.map((action) => action.content).join(" ");
    const itemText = project.items.map((item) => item.sourceContent).join(" ");
    return [project.title, project.outcome, project.theme, actionText, itemText]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ja")
      .includes(query);
  });
}

const COMPLETED_PAGE = 10;
/** サーバーの STALE_DAYS と同じ。停滞の説明に使う。 */
const STALE_DAYS = 14;

/** 並び順ごとの説明。要確認をどう扱うかを一覧の上に示す（#142）。 */
const sortNotes = {
  recommended: "要確認を先頭にまとめ、その中で目標日が近い順に並べています",
  target: "目標日が近い順（未設定は最後）。要確認も日付どおりに並び、バッジで見分けます",
  review: "再確認・見直し日が近い順（未設定は最後）。要確認も日付どおりに並び、バッジで見分けます",
  updated: "更新が新しい順。要確認も更新日どおりに並び、バッジで見分けます",
};

function byDate(field) {
  return (left, right) => {
    const a = left[field];
    const b = right[field];
    if (a && b && a !== b) return a.localeCompare(b);
    if (a !== b) return a ? -1 : 1;
    if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id;
  };
}

/** APIの並び（要確認 → 目標日 → 更新）を「おすすめ」とし、ほかは日付で並べ替える。 */
function sortProjects(projects, sort) {
  if (sort === "target") return [...projects].sort(byDate("targetOn"));
  if (sort === "review") return [...projects].sort(byDate("reviewOn"));
  if (sort === "updated") return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id);
  return projects;
}

function staleDays(project, today = todayTokyo()) {
  return dayDiff(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(project.lastActivityAt)), today);
}

function statusBadge(project) {
  if (project.needsAttention) return '<span class="badge attention">要確認</span>';
  if (project.stale) return `<span class="badge stale">停滞 ${staleDays(project)}日</span>`;
  if (project.status === "waiting" || project.status === "on_hold") return `<span class="badge waiting">${statusLabels[project.status]}</span>`;
  if (project.status === "completed" || project.status === "dropped") return `<span class="badge done">${statusLabels[project.status]}</span>`;
  return '<span class="badge">進行中</span>';
}

function actionPanel(project) {
  if (project.nextAction) {
    return `<div class="next-action"><small>NEXT ACTION</small><strong>${escapeHtml(project.nextAction.content)}</strong>${actionDateChips(project.nextAction, todayTokyo())}</div>`;
  }
  if (project.status === "waiting") {
    return `<div class="next-action waiting"><small>WAITING</small><strong>${escapeHtml(project.waitingFor)} · ${displayDate(project.reviewOn)}再確認</strong></div>`;
  }
  if (project.status === "on_hold") {
    return `<div class="next-action waiting"><small>ON HOLD</small><strong>${displayDate(project.reviewOn)}に見直す</strong></div>`;
  }
  if (project.status === "completed") {
    return '<div class="next-action waiting"><small>COMPLETED</small><strong>目標を達成しました</strong></div>';
  }
  return '<div class="next-action missing"><small>NEEDS ATTENTION</small><strong>Next Actionを決めてください</strong></div>';
}

function projectCard(project) {
  const queued = project.actions.filter((action) => action.status === "queued").length;
  const unprocessed = project.items.filter((item) => item.treatment === "unprocessed").length;
  const meta = [
    project.theme ? `テーマ: ${escapeHtml(project.theme)}` : null,
    project.targetOn ? `目標 ${displayDate(project.targetOn)}` : null,
    project.reviewOn && project.status !== "active" ? `再確認 ${displayDate(project.reviewOn)}` : null,
    queued ? `Action候補 ${queued}` : null,
    unprocessed ? `未整理 ${unprocessed}` : null,
  ].filter(Boolean).map((value) => `<span>${value}</span>`).join("");
  const completeButton = project.nextAction
    ? `<button class="complete-action" type="button" data-resolve="${project.id}">Action完了</button>`
    : "";
  return `
    <article class="project-card ${project.needsAttention ? "needs-attention" : ""}">
      <div class="project-copy">
        <div class="project-heading">${statusBadge(project)}<h3>${escapeHtml(project.title)}</h3></div>
        <p>${escapeHtml(project.outcome)}</p>
        <div class="project-meta">${meta || "<span>期限なし</span>"}</div>
      </div>
      ${actionPanel(project)}
      <div class="card-actions">${completeButton}<button type="button" data-detail="${project.id}">詳細</button></div>
    </article>`;
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

function renderSummary() {
  const { summary } = state.data;
  els.activeCount.textContent = summary.active;
  els.attentionCount.textContent = summary.needsAttention;
  els.waitingCount.textContent = summary.waiting;
  els.completedCount.textContent = summary.completed;
  els.activeTabCount.textContent = summary.active;
  els.waitingTabCount.textContent = summary.waiting;
  els.completedTabCount.textContent = summary.completed;
  els.reviewTabCount.textContent = reviewData().pending;
}

/** 月曜始まりの今週の初日（JST）。 */
function weekStartTokyo(today) {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * 週次レビュー（#162）。docs/projects-operation.md の「毎週」を1画面にまとめる。
 * pending は見直しが必要な件数（今週の完了は含めない）。
 */
function reviewData() {
  const today = todayTokyo();
  const weekStart = weekStartTokyo(today);
  const projects = state.data?.projects || [];
  const open = projects.filter((project) => ["active", "waiting", "on_hold"].includes(project.status));
  const overdue = open.flatMap((project) => project.actions
    .filter((action) => (action.status === "next" || action.status === "queued") && action.dueOn && action.dueOn < today)
    .map((action) => ({ project, action })))
    .sort((left, right) => left.action.dueOn.localeCompare(right.action.dueOn));
  const attention = projects.filter((project) => project.needsAttention);
  const reviewDue = open.filter((project) => project.status !== "active" && project.reviewOn && project.reviewOn <= today)
    .sort((left, right) => left.reviewOn.localeCompare(right.reviewOn));
  const stale = projects.filter((project) => project.stale)
    .sort((left, right) => left.lastActivityAt.localeCompare(right.lastActivityAt));
  const doneThisWeek = projects.map((project) => ({
    project,
    actions: project.actions.filter((action) => action.status === "done" && action.completedAt
      && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(action.completedAt)) >= weekStart),
  })).filter((entry) => entry.actions.length).sort((left, right) => right.actions.length - left.actions.length);
  return {
    today, weekStart, overdue, attention, reviewDue, stale, doneThisWeek,
    pending: overdue.length + attention.length + reviewDue.length + stale.length,
  };
}

function reviewSection(title, note, count, rows, empty) {
  return `<section class="review-section"><header><h3>${title}</h3><b>${count}</b><small>${note}</small></header>${count
    ? `<div class="review-rows">${rows}</div>` : `<p class="review-empty">✓ ${empty}</p>`}</section>`;
}

function reviewRow(project, main, chips) {
  return `<button class="review-row" type="button" data-detail="${project.id}"><span><strong>${main}</strong><small>${escapeHtml(project.title)}</small></span><span class="date-chips">${chips}</span></button>`;
}

function renderReview() {
  const data = reviewData();
  els.resultCount.textContent = `見直し ${data.pending}件`;
  const attentionReason = (project) => {
    const unprocessed = project.items.filter((item) => item.treatment === "unprocessed").length;
    return [project.status === "active" && !project.actions.some((action) => ["next", "queued", "waiting"].includes(action.status)) ? "次の一手が未設定" : null,
      unprocessed ? `未整理 ${unprocessed}件` : null].filter(Boolean).join(" · ");
  };
  const doneCount = data.doneThisWeek.reduce((total, entry) => total + entry.actions.length, 0);
  els.projectList.innerHTML = `<div class="review-board">
    ${reviewSection("期限超過のタスク", "期日を過ぎた未完了のタスク", data.overdue.length,
      data.overdue.map(({ project, action }) => reviewRow(project, escapeHtml(action.content),
        `<span class="date-chip overdue">期日 ${displayDate(action.dueOn)}（${dayDiff(action.dueOn, data.today)}日超過）</span>`)).join(""),
      "期限を過ぎたタスクはありません")}
    ${reviewSection("要確認", "次の一手や関連アイテムの整理が必要", data.attention.length,
      data.attention.map((project) => reviewRow(project, `完了条件: ${escapeHtml(project.outcome)}`, `<span class="date-chip warn">${escapeHtml(attentionReason(project) || "要確認")}</span>`)).join(""),
      "要確認のProjectはありません")}
    ${reviewSection("再確認・見直し日", "待機・保留で日付が来たもの", data.reviewDue.length,
      data.reviewDue.map((project) => reviewRow(project, escapeHtml(project.status === "waiting" ? `${project.waitingFor}を待っています` : "保留中"),
        `<span class="date-chip soon">${project.status === "waiting" ? "再確認" : "見直し"} ${displayDate(project.reviewOn)}</span>`)).join(""),
      "見直し日が来たProjectはありません")}
    ${reviewSection("停滞", `進行中で${STALE_DAYS}日以上動きがない`, data.stale.length,
      data.stale.map((project) => reviewRow(project, escapeHtml(project.nextAction?.content || "Next Action未設定"),
        `<span class="date-chip stale">${staleDays(project, data.today)}日動きなし</span>`)).join(""),
      "停滞しているProjectはありません")}
    ${reviewSection("今週完了したタスク", `${displayDate(data.weekStart)}〜`, doneCount,
      data.doneThisWeek.map(({ project, actions }) => `<div class="review-done"><button type="button" data-detail="${project.id}"><strong>${escapeHtml(project.title)}</strong><b>${actions.length}件</b></button><ul>${actions.map((action) => `<li>${escapeHtml(action.content)}</li>`).join("")}</ul></div>`).join(""),
      "今週完了したタスクはまだありません")}
  </div>`;
}

function renderList() {
  if (!state.data) return;
  const reviewing = state.view === "review";
  els.filtersBar.hidden = reviewing;
  els.sortNote.hidden = reviewing;
  if (reviewing) {
    els.clearFilters.hidden = true;
    renderReview();
    return;
  }
  const projects = sortProjects(projectsForView(), state.sort);
  els.sortNote.textContent = sortNotes[state.sort];
  els.resultCount.textContent = `${projects.length}件${state.attentionOnly ? " · 要確認のみ" : ""}`;
  els.clearFilters.hidden = !state.search && !state.attentionOnly;
  els.projectList.innerHTML = projects.length
    ? projects.map(projectCard).join("")
    : '<div class="state-card">この条件のProjectはありません。</div>';
}

function renderAll() {
  renderSummary();
  renderList();
  if (state.selectedId && !getProject(state.selectedId)) closeDetail(false);
}

async function loadProjects() {
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.projectList.hidden = true;
  try {
    const response = await fetch("/api/projects", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : "Projectを読み込めませんでした。";
    if (!response.ok) throw new Error(message);
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
    const response = await fetch("/api/projects", {
      method: project ? "PATCH" : "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": project ? "project-update" : "project-create",
      },
      body: JSON.stringify(body),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "Projectを保存できませんでした。");
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

function relatedItemRow(item) {
  const view = item.sourceType === "inbox" ? "inbox" : "wants";
  const label = item.sourceType === "inbox" ? "Inbox" : "Want";
  const source = `<div class="related-copy"><span><a href="/compass/?view=${view}&id=${item.sourceId}">${label} #${item.sourceId}</a> · ${escapeHtml(item.sourceContent)}</span><small>${treatmentLabels[item.treatment]}</small></div>`;
  if (item.treatment !== "unprocessed") return `<div class="related-row">${source}</div>`;
  const action = item.sourceContent.slice(0, 500);
  return `<div class="related-row related-row-unprocessed" data-project-item-row="${item.id}">
    ${source}
    <form class="related-action-form" data-project-item-action="${item.id}">
      <input maxlength="500" value="${escapeHtml(action)}" aria-label="Actionの内容" required />
      <button type="submit">Actionにする</button>
    </form>
    <div class="related-treatment-actions">
      <button type="button" data-project-item-treatment="reference" data-project-item-id="${item.id}">参考情報</button>
      <button type="button" data-project-item-treatment="rejected" data-project-item-id="${item.id}">対象外</button>
    </div>
    <p class="form-error" data-project-item-error="${item.id}" role="alert" hidden></p>
  </div>`;
}

function milestoneOptions(project, selectedId) {
  const open = project.milestones.filter((milestone) => milestone.status === "open" || milestone.id === selectedId);
  return `<option value="">マイルストンなし</option>${open.map((milestone) =>
    `<option value="${milestone.id}"${milestone.id === selectedId ? " selected" : ""}>${escapeHtml(milestone.title)}</option>`).join("")}`;
}

function actionEditForm(action, cancellable, project) {
  const milestoneField = project.milestones.length
    ? `<label class="action-edit-content"><span>マイルストン</span><select name="milestoneId">${milestoneOptions(project, action.milestoneId)}</select></label>`
    : "";
  return `<form class="action-edit-form" data-action-edit="${action.id}">
    <label class="action-edit-content"><span>内容</span><input name="content" maxlength="500" required value="${escapeHtml(action.content)}" /></label>
    <label><span>着手日</span><input name="startOn" type="date" value="${escapeHtml(action.startOn || "")}" /></label>
    <label><span>期日</span><input name="dueOn" type="date" value="${escapeHtml(action.dueOn || "")}" /></label>
    ${milestoneField}
    <div class="action-edit-buttons">
      ${cancellable ? `<button class="danger-link" type="button" data-action-op="cancel" data-action-id="${action.id}">このActionを取り消す</button>` : ""}
      <button type="button" data-action-edit-close>キャンセル</button>
      <button class="primary" type="submit">保存</button>
    </div>
  </form>`;
}

/** あとで行うAction1件。並べ替え・今やる・完了・編集をその場で行う（#153）。 */
function queuedActionRow(action, index, count, project, today, milestone = null) {
  const errorRow = `<p class="form-error" data-action-error="${action.id}" role="alert" hidden></p>`;
  if (state.editingActionId === action.id) {
    return `<div class="task-row editing" data-action-row="${action.id}">${actionEditForm(action, true, project)}${errorRow}</div>`;
  }
  // 期日の整合は制約にせず、目安として知らせるだけ（#161）
  const late = milestone?.dueOn && action.dueOn && action.dueOn > milestone.dueOn
    ? '<span class="date-chip warn">マイルストンの期日より後</span>' : "";
  const pin = project.status === "active"
    ? `<button type="button" data-action-op="pin" data-action-id="${action.id}">今やる</button>`
    : "";
  return `<div class="task-row" data-action-row="${action.id}">
    <div class="task-order">
      <button type="button" data-action-op="move_up" data-action-id="${action.id}" aria-label="上へ移動" ${index === 0 ? "disabled" : ""}>↑</button>
      <button type="button" data-action-op="move_down" data-action-id="${action.id}" aria-label="下へ移動" ${index === count - 1 ? "disabled" : ""}>↓</button>
    </div>
    <div class="task-main"><span>${escapeHtml(action.content)}</span>${actionDateChips(action, today)}${late}</div>
    <div class="task-buttons">
      ${pin}
      <button type="button" data-action-op="complete" data-action-id="${action.id}">完了</button>
      <button type="button" data-action-edit-open="${action.id}">編集</button>
    </div>
    ${errorRow}
  </div>`;
}

function milestoneEditForm(project, milestone = null) {
  const id = milestone ? milestone.id : "new";
  return `<form class="milestone-form" data-milestone-form="${id}">
    <label class="milestone-form-title"><span>マイルストン</span><input name="title" maxlength="240" required value="${escapeHtml(milestone?.title || "")}" placeholder="例：教材を決めて毎日30分の習慣にする" /></label>
    <label><span>期日（任意）</span><input name="dueOn" type="date" value="${escapeHtml(milestone?.dueOn || "")}" /></label>
    <div class="action-edit-buttons">
      ${milestone ? `<button class="danger-link" type="button" data-milestone-op="delete" data-milestone-id="${milestone.id}">削除（タスクは残す）</button><button type="button" data-milestone-edit-close>キャンセル</button>` : ""}
      <button class="primary" type="submit">${milestone ? "保存" : "マイルストンを追加"}</button>
    </div>
    <p class="form-error" data-milestone-error="${id}" role="alert" hidden></p>
  </form>`;
}

function milestoneDueChip(milestone, project, today) {
  const chips = [];
  if (milestone.dueOn) {
    const days = dayDiff(today, milestone.dueOn);
    const tone = milestone.status === "done" ? "" : days < 0 ? " overdue" : days <= 3 ? " soon" : "";
    const note = milestone.status === "done" ? "" : days < 0 ? `（${-days}日超過）` : days === 0 ? "（今日）" : `（あと${days}日）`;
    chips.push(`<span class="date-chip${tone}">期日 ${displayDate(milestone.dueOn)}${note}</span>`);
  }
  if (milestone.dueOn && project.targetOn && milestone.dueOn > project.targetOn) {
    chips.push('<span class="date-chip warn">目標日より後</span>');
  }
  return chips.join("");
}

/** マイルストン1つ分。見出し（進捗・期日・操作）と、その下のあとで行うAction（#161）。 */
function milestoneGroup(project, milestone, index, count, tasks, today) {
  const editing = state.editingMilestoneId === milestone.id;
  const done = milestone.status === "done";
  const progress = `${milestone.done}/${milestone.total}`;
  const head = editing
    ? milestoneEditForm(project, milestone)
    : `<div class="milestone-head">
      <div class="task-order">
        <button type="button" data-milestone-op="move_up" data-milestone-id="${milestone.id}" aria-label="マイルストンを上へ" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-milestone-op="move_down" data-milestone-id="${milestone.id}" aria-label="マイルストンを下へ" ${index === count - 1 ? "disabled" : ""}>↓</button>
      </div>
      <div class="milestone-main">
        <strong>${done ? "✓ " : ""}${escapeHtml(milestone.title)}</strong>
        <span class="date-chips"><span class="date-chip progress">完了 ${progress}</span>${milestoneDueChip(milestone, project, today)}</span>
      </div>
      <div class="task-buttons">
        <button type="button" data-milestone-op="${done ? "reopen" : "complete"}" data-milestone-id="${milestone.id}">${done ? "再開" : "達成"}</button>
        <button type="button" data-milestone-edit-open="${milestone.id}">編集</button>
      </div>
      <p class="form-error" data-milestone-error="${milestone.id}" role="alert" hidden></p>
    </div>`;
  const rows = tasks.length
    ? `<div class="action-list">${tasks.map((action, taskIndex) => queuedActionRow(action, taskIndex, tasks.length, project, today, milestone)).join("")}</div>`
    : done ? "" : '<p class="empty-detail">このマイルストンのタスクはまだありません。</p>';
  return `<div class="milestone-group${done ? " done" : ""}" data-milestone-row="${milestone.id}">${head}${rows}</div>`;
}

function bulkAddForm(project) {
  if (project.status !== "active") return "";
  const select = project.milestones.some((milestone) => milestone.status === "open")
    ? `<label><span>追加先</span><select name="milestoneId">${milestoneOptions(project, null)}</select></label>`
    : "";
  return `<details class="bulk-add"${state.bulkOpen ? " open" : ""}>
    <summary>まとめて追加（1行に1タスク）</summary>
    <form class="bulk-add-form" id="bulkAddForm">
      <label><span>タスク</span><textarea name="contents" rows="5" placeholder="教材を3冊比べる\n体験レッスンを予約する\n毎朝の30分を確保する"></textarea></label>
      ${select}
      <div class="action-edit-buttons"><button class="primary" type="submit">まとめて追加</button></div>
      <p class="form-error" id="bulkAddError" role="alert" hidden></p>
    </form>
  </details>`;
}

function renderDetail(project) {
  const today = todayTokyo();
  const queued = project.actions.filter((action) => action.status === "queued");
  const completed = project.actions.filter((action) => action.status === "done");
  const next = project.nextAction;
  const nextMilestone = next ? project.milestones.find((milestone) => milestone.id === next.milestoneId) : null;
  const current = next && state.editingActionId === next.id
    ? `<div class="detail-next editing" data-action-row="${next.id}">${actionEditForm(next, false, project)}<p class="form-error" data-action-error="${next.id}" role="alert" hidden></p></div>`
    : next
    ? `<div class="detail-next" data-action-row="${next.id}">${nextMilestone ? `<small class="detail-next-milestone">${escapeHtml(nextMilestone.title)}</small>` : ""}<strong>${escapeHtml(next.content)}</strong>${actionDateChips(next, today)}<div class="detail-next-buttons"><button id="detailResolveButton" type="button">完了して次を決める</button><button class="quiet" type="button" data-action-edit-open="${next.id}">編集</button></div><p class="form-error" data-action-error="${next.id}" role="alert" hidden></p></div>`
    : project.status === "waiting"
      ? `<div class="detail-next"><strong>${escapeHtml(project.waitingFor)}を待っています。${displayDate(project.reviewOn)}に再確認します。</strong></div>`
      : project.status === "on_hold"
        ? `<div class="detail-next"><strong>${displayDate(project.reviewOn)}にProjectを見直します。</strong></div>`
        : '<p class="empty-detail">現在のNext Actionがありません。</p>';
  const actionForm = project.status === "active" || project.status === "waiting" || project.status === "on_hold"
    ? `<form class="inline-action-form" id="detailActionForm"><input id="detailActionInput" maxlength="500" required placeholder="${project.status === "active" ? "あとで行うAction候補" : "再開時のNext Action"}" /><button type="submit">${project.status === "active" ? "候補に追加" : "次を決めて再開"}</button></form><p class="form-error" id="detailActionError" role="alert" hidden></p>`
    : "";
  // マイルストンごとに、あとで行うActionをまとめる（#161）。達成済みのマイルストンは後ろに回す。
  const ordered = [...project.milestones.filter((milestone) => milestone.status === "open"), ...project.milestones.filter((milestone) => milestone.status === "done")];
  const knownMilestones = new Set(project.milestones.map((milestone) => milestone.id));
  const loose = queued.filter((action) => !action.milestoneId || !knownMilestones.has(action.milestoneId));
  const groups = ordered.map((milestone) => milestoneGroup(
    project, milestone, project.milestones.indexOf(milestone), project.milestones.length,
    queued.filter((action) => action.milestoneId === milestone.id), today,
  )).join("");
  const looseRows = loose.length
    ? `<div class="action-list">${loose.map((action, index) => queuedActionRow(action, index, loose.length, project, today)).join("")}</div>`
    : project.milestones.length ? "" : '<p class="empty-detail">Action候補はありません。</p>';
  const looseGroup = project.milestones.length
    ? (loose.length ? `<div class="milestone-group loose"><div class="milestone-head"><div class="milestone-main"><strong>マイルストンなし</strong></div></div>${looseRows}</div>` : "")
    : looseRows;
  const canEditMilestones = project.status !== "completed" && project.status !== "dropped";
  const addMilestone = canEditMilestones
    ? `<details class="milestone-add"${state.editingMilestoneId === "new" ? " open" : ""}><summary>マイルストンを追加</summary>${milestoneEditForm(project)}</details>`
    : "";
  const queuedRows = `${groups}${looseGroup}`;
  // 完了Actionは新しい順に10件ずつ表示し、古い履歴まで「さらに表示」でたどれる（#140）。
  const shownCompleted = completed.slice(0, state.completedShown);
  const remainingCompleted = completed.length - shownCompleted.length;
  const completedRows = completed.length
    ? `<div class="action-list">${shownCompleted.map((action) => `<div class="action-row"><span>${escapeHtml(action.content)}</span><small>${action.completedAt ? `完了 ${completedDate(action.completedAt)}` : "完了"}</small></div>`).join("")}</div>${remainingCompleted > 0
      ? `<div class="history-more"><button type="button" data-completed-more="${COMPLETED_PAGE}">さらに${Math.min(COMPLETED_PAGE, remainingCompleted)}件表示</button><button type="button" data-completed-more="all">すべて表示（残り${remainingCompleted}件）</button></div>`
      : ""}`
    : '<p class="empty-detail">完了したActionはまだありません。</p>';
  const relatedRows = project.items.length
    ? `<div class="related-list">${project.items.map(relatedItemRow).join("")}</div>`
    : '<p class="empty-detail">Inbox／Wantから関連づけた項目はまだありません。</p>';
  const meta = [
    `<span>状態: ${statusLabels[project.status]}</span>`,
    project.theme ? `<span>テーマ: ${escapeHtml(project.theme)}</span>` : null,
    project.targetOn ? `<span>目標日: ${escapeHtml(project.targetOn)}</span>` : "<span>目標日: 未設定</span>",
    project.reviewOn ? `<span>見直し: ${escapeHtml(project.reviewOn)}</span>` : null,
  ].filter(Boolean).join("");

  els.detailKicker.textContent = project.theme || "PROJECT";
  els.detailTitle.textContent = project.title;
  els.detailBody.innerHTML = `
    <section class="detail-summary"><p>${escapeHtml(project.outcome)}</p><div class="detail-meta">${meta}</div></section>
    <div class="detail-toolbar"><button id="detailEditButton" type="button">目標を編集</button></div>
    <section class="detail-section"><header><h3>現在のNext Action</h3></header>${current}</section>
    <section class="detail-section"><header><h3>道筋とあとで行うAction</h3><small>マイルストン${project.milestones.length}件 · 候補${queued.length}件</small></header>${queuedRows}${actionForm}${bulkAddForm(project)}${addMilestone}</section>
    <section class="detail-section"><header><h3>関連するInbox／Wants</h3><small>${project.items.length}件</small></header>${relatedRows}</section>
    <section class="detail-section" id="completedHistory"><header><h3>完了履歴</h3><small>${completed.length}件${completed.length > shownCompleted.length ? `中 ${shownCompleted.length}件を表示` : ""}</small></header>${completedRows}</section>`;

  els.detailBody.querySelectorAll("[data-completed-more]").forEach((button) => button.addEventListener("click", () => {
    state.completedShown = button.dataset.completedMore === "all" ? Infinity : state.completedShown + COMPLETED_PAGE;
    renderDetail(project);
  }));
  document.getElementById("detailEditButton")?.addEventListener("click", () => openProjectEditor(project));
  document.getElementById("detailResolveButton")?.addEventListener("click", () => openResolve(project));
  document.getElementById("detailActionForm")?.addEventListener("submit", (event) => saveProjectAction(event, project.id));
  els.detailBody.querySelectorAll("[data-action-edit-open]").forEach((button) => button.addEventListener("click", () => {
    state.editingActionId = Number(button.dataset.actionEditOpen);
    renderDetail(project);
    els.detailBody.querySelector(`[data-action-edit="${state.editingActionId}"] input[name=content]`)?.focus();
  }));
  els.detailBody.querySelectorAll("[data-action-edit-close]").forEach((button) => button.addEventListener("click", () => {
    state.editingActionId = null;
    renderDetail(project);
  }));
  els.detailBody.querySelectorAll("[data-action-edit]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const action = project.actions.find((candidate) => candidate.id === Number(form.dataset.actionEdit));
    updateAction(project.id, Number(form.dataset.actionEdit), "edit", {
      content: String(data.get("content") || ""),
      startOn: String(data.get("startOn") || "") || null,
      dueOn: String(data.get("dueOn") || "") || null,
      // マイルストンの欄がない（マイルストン未作成）ときは今の値を保つ
      milestoneId: data.has("milestoneId") ? Number(data.get("milestoneId")) || null : action?.milestoneId ?? null,
    });
  }));
  els.detailBody.querySelectorAll("[data-milestone-edit-open]").forEach((button) => button.addEventListener("click", () => {
    state.editingMilestoneId = Number(button.dataset.milestoneEditOpen);
    renderDetail(project);
    els.detailBody.querySelector(`[data-milestone-form="${state.editingMilestoneId}"] input[name=title]`)?.focus();
  }));
  els.detailBody.querySelectorAll("[data-milestone-edit-close]").forEach((button) => button.addEventListener("click", () => {
    state.editingMilestoneId = null;
    renderDetail(project);
  }));
  els.detailBody.querySelectorAll("[data-milestone-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const id = form.dataset.milestoneForm;
    updateMilestone(project.id, id === "new" ? null : Number(id), id === "new" ? "create" : "edit", {
      title: String(data.get("title") || ""),
      dueOn: String(data.get("dueOn") || "") || null,
    });
  }));
  els.detailBody.querySelectorAll("[data-milestone-op]").forEach((button) => button.addEventListener("click", () => {
    const operation = button.dataset.milestoneOp;
    if (operation === "delete" && !window.confirm("このマイルストンを削除しますか？タスクは「マイルストンなし」に残ります。")) return;
    updateMilestone(project.id, Number(button.dataset.milestoneId), operation);
  }));
  els.detailBody.querySelector(".bulk-add")?.addEventListener("toggle", (event) => { state.bulkOpen = event.currentTarget.open; });
  document.getElementById("bulkAddForm")?.addEventListener("submit", (event) => saveBulkActions(event, project.id));
  els.detailBody.querySelectorAll("[data-action-op]").forEach((button) => button.addEventListener("click", () => {
    const operation = button.dataset.actionOp;
    if (operation === "cancel" && !window.confirm("このActionを取り消しますか？")) return;
    updateAction(project.id, Number(button.dataset.actionId), operation);
  }));
  els.detailBody.querySelectorAll("[data-project-item-action]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    if (input?.value.trim()) processRelatedItem(project.id, Number(form.dataset.projectItemAction), "action_source", input.value.trim());
  }));
  els.detailBody.querySelectorAll("[data-project-item-treatment]").forEach((button) => button.addEventListener("click", () => {
    processRelatedItem(project.id, Number(button.dataset.projectItemId), button.dataset.projectItemTreatment, null);
  }));
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
    const response = await fetch("/api/project-actions", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-create" },
      body: JSON.stringify({
        operation: project.status === "active" ? "addQueued" : "resume",
        projectId: project.id,
        content: input.value,
        originalProjectUpdatedAt: project.updatedAt,
      }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "Actionを保存できませんでした。");
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
    const response = await fetch("/api/project-actions", {
      method: "PUT",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-update" },
      body: JSON.stringify({ actionId, originalUpdatedAt: action.updatedAt, operation, ...fields }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "Actionを更新できませんでした。");
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
    const response = await fetch("/api/project-milestones", {
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
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "マイルストンを更新できませんでした。");
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
    const response = await fetch("/api/project-actions", {
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
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "タスクを追加できませんでした。");
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
    const response = await fetch("/api/project-items", {
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
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "関連アイテムを整理できませんでした。");
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
    const response = await fetch("/api/project-actions", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "project-action-resolve" },
      body: JSON.stringify(body),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(payload.error || "Actionを完了できませんでした。");
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
