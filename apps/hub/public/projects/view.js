import { escapeHtml } from "../shared/html.js";
import { compassHistoryPath } from "../compass-routing.js";
import { groupMilestoneActions } from "./milestones.js";
import { reviewReasons } from "./goals.js";
// Projectsの一覧・レビュー・詳細の描画。変更操作はcontrollerから渡されたコールバックに委ねる。

export function createProjectView({
  displayDate,
  dayDiff,
  staleDays,
  todayTokyo,
  state,
  els,
  reviewData,
  STALE_DAYS,
  sortProjects,
  projectsForView,
  getProject,
  closeDetail,
  completedDate,
  COMPLETED_PAGE,
  openProjectEditor,
  openResolve,
  saveProjectAction,
  updateAction,
  updateMilestone,
  saveBulkActions,
  processRelatedItem,
  openActionTodo,
  unlinkActionTodo,
  loadMoreDetail,
  markProjectReviewed,
  saveCaptureDraft,
  refreshCapture,
  openProjectHabits,
  openProjectSchedule,
}) {
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

  /** Actionの着手日・期日を短いチップにする。期限超過・3日以内・着手日到来を色で分ける（#153）。 */
  function actionDateChips(action, today) {
    if (action.linkedTodo) {
      const todo = action.linkedTodo;
      const time = todo.schedule.allDay
        ? "終日"
        : `${todo.schedule.startTime}〜${todo.schedule.endTime}`;
      return `<span class="date-chips"><span class="date-chip${todo.status === "pending" && todo.schedule.date < today ? " overdue" : ""}">予定 ${displayDate(todo.schedule.date)} ${escapeHtml(time)}</span>${todo.calendarState !== "confirmed" ? '<span class="date-chip warn">Calendar要確認</span>' : ""}</span>`;
    }
    const chips = [];
    if (action.startOn) {
      const ready = action.startOn <= today;
      chips.push(
        `<span class="date-chip${ready ? " start-ready" : ""}">着手 ${displayDate(action.startOn)}</span>`,
      );
    }
    if (action.dueOn) {
      const days = dayDiff(today, action.dueOn);
      const tone = days < 0 ? " overdue" : days <= 3 ? " soon" : "";
      const note = days < 0 ? `${-days}日超過` : days === 0 ? "今日" : `あと${days}日`;
      chips.push(
        `<span class="date-chip${tone}">期日 ${displayDate(action.dueOn)}（${note}）</span>`,
      );
    }
    return chips.length ? `<span class="date-chips">${chips.join("")}</span>` : "";
  }

  function todoLinkControls(action, project) {
    const todo = action.linkedTodo;
    if (todo)
      return `<div class="project-todo-link"><a href="${escapeHtml(compassHistoryPath("todos", todo.id))}">ToDo: ${escapeHtml(todo.title)} · ${todo.status === "completed" ? "完了" : todo.status === "skipped" ? "見送り" : "未実施"}</a><button type="button" data-action-todo-unlink="${action.id}">紐づけを解除</button></div>`;
    return ["completed", "dropped"].includes(project.status)
      ? ""
      : `<div class="project-todo-link"><button type="button" data-action-todo-link="${action.id}">既存ToDoと紐づける</button>${["next", "queued", "waiting"].includes(action.status) ? `<button type="button" data-action-schedule="${action.id}">予定を作成</button>` : ""}</div>`;
  }

  function statusBadge(project) {
    if (project.needsAttention) return '<span class="badge attention">要確認</span>';
    if (project.stale) return `<span class="badge stale">更新なし ${staleDays(project)}日</span>`;
    if (project.status === "waiting" || project.status === "on_hold")
      return `<span class="badge waiting">${statusLabels[project.status]}</span>`;
    if (project.status === "completed" || project.status === "dropped")
      return `<span class="badge done">${statusLabels[project.status]}</span>`;
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
    const queued =
      project.counts?.queued ??
      project.actions.filter((action) => action.status === "queued").length;
    const unprocessed =
      project.counts?.unprocessed ??
      project.items.filter((item) => item.treatment === "unprocessed").length;
    const meta = [
      project.theme ? `テーマ: ${escapeHtml(project.theme)}` : null,
      project.targetOn ? `目標 ${displayDate(project.targetOn)}` : null,
      project.reviewOn && project.status !== "active"
        ? `再確認 ${displayDate(project.reviewOn)}`
        : null,
      queued ? `Action候補 ${queued}` : null,
      unprocessed ? `未整理 ${unprocessed}` : null,
    ]
      .filter(Boolean)
      .map((value) => `<span>${value}</span>`)
      .join("");
    const completeButton = project.nextAction
      ? `<button class="complete-action" type="button" data-resolve="${project.id}">Action完了</button>`
      : "";
    const goal = state.goals?.[project.id];
    const progress = goal
      ? `<div class="project-progress">${goal.nextMilestone ? `<span>次の節目: ${escapeHtml(goal.nextMilestone.title)}</span>` : ""}<span>今週完了したAction ${goal.weekDone}件</span></div>`
      : state.goalErrors?.[project.id]
        ? '<div class="project-progress">実績を取得できませんでした</div>'
        : "";
    return `
      <article class="project-card ${project.needsAttention ? "needs-attention" : ""}">
        <div class="project-copy">
          <div class="project-heading">${statusBadge(project)}<h3>${escapeHtml(project.title)}</h3></div>
          <p>${escapeHtml(project.outcome)}</p>
          <div class="project-meta">${meta || "<span>期限なし</span>"}</div>
          ${progress}
        </div>
        ${actionPanel(project)}
        <div class="card-actions">${completeButton}<button type="button" data-detail="${project.id}">詳細</button></div>
      </article>`;
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
    els.reviewTabCount.textContent =
      state.view === "review" ? reviewData().pending : (state.data.summary.reviewPending ?? "—");
  }

  function reviewSection(title, note, count, rows, empty) {
    return `<section class="review-section"><header><h3>${title}</h3><b>${count}</b><small>${note}</small></header>${
      count ? `<div class="review-rows">${rows}</div>` : `<p class="review-empty">✓ ${empty}</p>`
    }</section>`;
  }

  function reviewRow(project, main, chips, detail = project.title) {
    return `<button class="review-row" type="button" data-detail="${project.id}"><span><strong>${main}</strong><small>${escapeHtml(detail)}</small></span><span class="date-chips">${chips}</span></button>`;
  }

  function renderReview() {
    const data = reviewData();
    els.resultCount.textContent = `見直し項目 ${data.pending}件`;
    const attentionReason = (project) => {
      const unprocessed =
        project.counts?.unprocessed ??
        project.items.filter((item) => item.treatment === "unprocessed").length;
      return [
        project.status === "active" &&
        (project.counts
          ? project.counts.open === 0
          : !project.actions.some((action) =>
              ["next", "queued", "waiting"].includes(action.status),
            ))
          ? "次の一手が未設定"
          : null,
        unprocessed ? `未整理 ${unprocessed}件` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    };
    const doneCount = data.doneThisWeek.reduce((total, entry) => total + entry.actions.length, 0);
    const active = (state.data?.projects || []).filter((project) => project.status === "active");
    const reviewRows = active
      .map((project) => {
        const goal = state.goals?.[project.id];
        const reasons = reviewReasons(project, data);
        const last = goal?.lastReviewedAt
          ? `最終レビュー ${completedDate(goal.lastReviewedAt)}${goal.reviewCurrent ? "" : " · 確認後に変更あり"}`
          : "レビュー未記録";
        return `<div class="goal-review-row"><button type="button" class="goal-review-open" data-detail="${project.id}"><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(project.outcome)}</span><small>${escapeHtml(project.nextAction?.content || "Next未選択")} · ${goal ? `今週完了 ${goal.weekDone}件` : "実績取得不可"}</small>${reasons.length ? `<small>${escapeHtml(reasons.join(" · "))}</small>` : ""}<small>${goal ? escapeHtml(last) : "確認情報を再読み込みしてください"}</small></button><div><button type="button" data-review-mark="${project.id}" ${!goal || goal.projectUpdatedAt !== project.updatedAt ? "disabled" : ""}>このまま続ける・確認済み</button><button type="button" data-detail="${project.id}">次の一手を見直す</button></div></div>`;
      })
      .join("");
    els.projectList.innerHTML = `<div class="review-board">
      ${reviewSection("進行中の目標を見渡す", "確認は明示操作で記録", active.length, reviewRows, "進行中のProjectはありません")}
      ${reviewSection(
        "目標期限を過ぎたProject",
        "目標日の古い順",
        data.targetOverdue.length,
        data.targetOverdue
          .map((project) =>
            reviewRow(
              project,
              escapeHtml(project.title),
              `<span class="date-chip overdue">目標 ${displayDate(project.targetOn)}（${dayDiff(project.targetOn, data.today)}日超過）</span><span class="date-chip">${statusLabels[project.status]}</span>`,
              `完了条件: ${project.outcome}`,
            ),
          )
          .join(""),
        "目標期限を過ぎたProjectはありません",
      )}
      ${reviewSection(
        "期限超過のタスク",
        "期日を過ぎた未完了のタスク",
        data.overdue.length,
        data.overdue
          .map(({ project, action }) =>
            reviewRow(
              project,
              escapeHtml(action.content),
              `<span class="date-chip overdue">期日 ${displayDate(action.dueOn)}（${dayDiff(action.dueOn, data.today)}日超過）</span>`,
            ),
          )
          .join(""),
        "期限を過ぎたタスクはありません",
      )}
      ${reviewSection(
        "要確認",
        "次の一手や関連アイテムの整理が必要",
        data.attention.length,
        data.attention
          .map((project) =>
            reviewRow(
              project,
              `完了条件: ${escapeHtml(project.outcome)}`,
              `<span class="date-chip warn">${escapeHtml(attentionReason(project) || "要確認")}</span>`,
            ),
          )
          .join(""),
        "要確認のProjectはありません",
      )}
      ${reviewSection(
        "再確認・見直し日",
        "待機・保留で日付が来たもの",
        data.reviewDue.length,
        data.reviewDue
          .map((project) =>
            reviewRow(
              project,
              escapeHtml(
                project.status === "waiting" ? `${project.waitingFor}を待っています` : "保留中",
              ),
              `<span class="date-chip soon">${project.status === "waiting" ? "再確認" : "見直し"} ${displayDate(project.reviewOn)}</span>`,
            ),
          )
          .join(""),
        "見直し日が来たProjectはありません",
      )}
      ${reviewSection(
        "更新なし",
        `進行中で最終更新から${STALE_DAYS}日以上`,
        data.stale.length,
        data.stale
          .map((project) =>
            reviewRow(
              project,
              escapeHtml(project.nextAction?.content || "Next Action未設定"),
              `<span class="date-chip stale">最終更新から${staleDays(project, data.today)}日</span>`,
            ),
          )
          .join(""),
        "14日以上更新のないProjectはありません",
      )}
      ${reviewSection(
        "今週完了したタスク",
        `${displayDate(data.weekStart)}〜`,
        doneCount,
        data.doneThisWeek
          .map(
            ({ project, actions }) =>
              `<div class="review-done"><button type="button" data-detail="${project.id}"><strong>${escapeHtml(project.title)}</strong><b>${actions.length}件</b></button><ul>${actions.map((action) => `<li>${escapeHtml(action.content)}</li>`).join("")}</ul></div>`,
          )
          .join(""),
        "今週完了したタスクはまだありません",
      )}
    </div>`;
  }

  function renderList() {
    if (!state.data) return;
    const reviewing = state.view === "review";
    els.filtersBar.hidden = reviewing;
    if (reviewing) {
      els.clearFilters.hidden = true;
      renderReview();
      return;
    }
    const projects = sortProjects(projectsForView(), state.sort);
    els.resultCount.textContent = `${state.data.page?.total ?? projects.length}件${state.attentionOnly ? " · 要確認のみ" : ""}`;
    els.clearFilters.hidden = !state.search && !state.attentionOnly;
    els.projectList.innerHTML = projects.length
      ? projects.map(projectCard).join("")
      : '<div class="state-card">この条件のProjectはありません。</div>';
    if (state.data.page?.hasMore)
      els.projectList.insertAdjacentHTML(
        "beforeend",
        '<button type="button" data-projects-more>さらに表示</button>',
      );
  }

  function renderAll() {
    renderSummary();
    renderList();
    if (state.selectedId && !getProject(state.selectedId)) closeDetail(false);
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
    const open = project.milestones.filter(
      (milestone) => milestone.status === "open" || milestone.id === selectedId,
    );
    return `<option value="">マイルストンなし</option>${open
      .map(
        (milestone) =>
          `<option value="${milestone.id}"${milestone.id === selectedId ? " selected" : ""}>${escapeHtml(milestone.title)}</option>`,
      )
      .join("")}`;
  }

  function actionEditForm(action, cancellable, project) {
    const milestoneField = project.milestones.length
      ? `<label class="action-edit-content"><span>マイルストン</span><select name="milestoneId">${milestoneOptions(project, action.milestoneId)}</select></label>`
      : "";
    return `<form class="action-edit-form" data-action-edit="${action.id}">
      <label class="action-edit-content"><span>内容</span><input name="content" maxlength="500" required value="${escapeHtml(action.content)}" /></label>
      ${action.linkedTodo ? `<div class="action-edit-content">${actionDateChips(action, todayTokyo())}<a href="${escapeHtml(compassHistoryPath("todos", action.linkedTodo.id))}">ToDoで日時を変更</a></div>` : `<label><span>着手日</span><input name="startOn" type="date" value="${escapeHtml(action.startOn || "")}" /></label><label><span>期日</span><input name="dueOn" type="date" value="${escapeHtml(action.dueOn || "")}" /></label>`}
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
    const late =
      milestone?.dueOn && action.dueOn && action.dueOn > milestone.dueOn
        ? '<span class="date-chip warn">マイルストンの期日より後</span>'
        : "";
    const pin =
      project.status === "active"
        ? `<button type="button" data-action-op="pin" data-action-id="${action.id}">今やる</button>`
        : "";
    return `<div class="task-row" data-action-row="${action.id}">
      <div class="task-order">
        <button type="button" data-action-op="move_up" data-action-id="${action.id}" aria-label="上へ移動" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action-op="move_down" data-action-id="${action.id}" aria-label="下へ移動" ${index === count - 1 ? "disabled" : ""}>↓</button>
      </div>
      <div class="task-main"><span>${escapeHtml(action.content)}</span>${actionDateChips(action, today)}${late}${todoLinkControls(action, project)}</div>
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
      const tone =
        milestone.status === "done" ? "" : days < 0 ? " overdue" : days <= 3 ? " soon" : "";
      const note =
        milestone.status === "done"
          ? ""
          : days < 0
            ? `（${-days}日超過）`
            : days === 0
              ? "（今日）"
              : `（あと${days}日）`;
      chips.push(
        `<span class="date-chip${tone}">期日 ${displayDate(milestone.dueOn)}${note}</span>`,
      );
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
      : done
        ? ""
        : '<p class="empty-detail">このマイルストンのタスクはまだありません。</p>';
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
    const nextMilestone = next
      ? project.milestones.find((milestone) => milestone.id === next.milestoneId)
      : null;
    const current =
      next && state.editingActionId === next.id
        ? `<div class="detail-next editing" data-action-row="${next.id}">${actionEditForm(next, false, project)}<p class="form-error" data-action-error="${next.id}" role="alert" hidden></p></div>`
        : next
          ? `<div class="detail-next" data-action-row="${next.id}">${nextMilestone ? `<small class="detail-next-milestone">${escapeHtml(nextMilestone.title)}</small>` : ""}<strong>${escapeHtml(next.content)}</strong>${actionDateChips(next, today)}${todoLinkControls(next, project)}<div class="detail-next-buttons"><button id="detailResolveButton" type="button">完了して次を決める</button><button id="detailSkipButton" type="button">見送って次を決める</button><button class="quiet" type="button" data-action-edit-open="${next.id}">編集</button></div><p class="form-error" data-action-error="${next.id}" role="alert" hidden></p></div>`
          : project.status === "waiting"
            ? `<div class="detail-next"><strong>${escapeHtml(project.waitingFor)}を待っています。${displayDate(project.reviewOn)}に再確認します。</strong></div>`
            : project.status === "on_hold"
              ? `<div class="detail-next"><strong>${displayDate(project.reviewOn)}にProjectを見直します。</strong></div>`
              : '<p class="empty-detail">現在のNext Actionがありません。</p>';
    const draft = state.captureDrafts?.[project.id] || { content: "", pending: null };
    const actionForm =
      project.status === "active" || project.status === "waiting" || project.status === "on_hold"
        ? `<section class="detail-capture"><form class="inline-action-form" id="detailActionForm"><input id="detailActionInput" maxlength="500" required aria-label="思いついたAction候補" placeholder="思いついたAction候補" value="${escapeHtml(draft.content)}" ${draft.pending ? "readonly" : ""} /><button type="submit">${draft.pending ? "同じ内容で保存結果を確認" : "候補に追加"}</button></form><p class="form-error" id="detailActionError" role="alert" ${draft.error ? "" : "hidden"}>${escapeHtml(draft.error || "")}</p>${draft.canRebase ? '<button type="button" data-capture-refresh>最新状態を確認して入力を再開</button>' : ""}</section>`
        : "";
    const resumeForm = ["waiting", "on_hold"].includes(project.status)
      ? '<details class="project-resume"><summary>Next Actionを決めて再開する</summary><form class="inline-action-form" id="detailResumeForm"><input id="detailResumeInput" maxlength="500" required aria-label="再開時のNext Action" placeholder="再開時のNext Action" /><button type="submit">次を決めて再開</button></form><p class="form-error" role="alert" hidden></p></details>'
      : "";
    const goal = state.goals?.[project.id];
    const reviewed = goal?.lastReviewedAt
      ? `最終レビュー ${completedDate(goal.lastReviewedAt)}${goal.reviewCurrent ? "" : " · 確認後に変更あり"}`
      : "レビュー未記録";
    const reviewControls =
      project.status === "active"
        ? `<section class="detail-review"><span>${goal ? escapeHtml(reviewed) : "確認情報を取得できませんでした"}</span><button type="button" data-review-mark="${project.id}" ${!goal || goal.projectUpdatedAt !== project.updatedAt ? "disabled" : ""}>このまま続ける・確認済み</button><p class="form-error" data-review-error role="alert" hidden></p></section>`
        : "";
    // マイルストンごとに、あとで行うActionをまとめる（#161）。達成済みのマイルストンは後ろに回す。
    const ordered = [
      ...project.milestones.filter((milestone) => milestone.status === "open"),
      ...project.milestones.filter((milestone) => milestone.status === "done"),
    ];
    const {
      groups: queuedByMilestone,
      loose,
      positions: milestonePositions,
    } = groupMilestoneActions(queued, project.milestones);
    const groups = ordered
      .map((milestone) =>
        milestoneGroup(
          project,
          milestone,
          milestonePositions.get(milestone.id),
          project.milestones.length,
          queuedByMilestone.get(milestone.id) || [],
          today,
        ),
      )
      .join("");
    const looseRows = loose.length
      ? `<div class="action-list">${loose.map((action, index) => queuedActionRow(action, index, loose.length, project, today)).join("")}</div>`
      : project.milestones.length
        ? ""
        : '<p class="empty-detail">Action候補はありません。</p>';
    const looseGroup = project.milestones.length
      ? loose.length
        ? `<div class="milestone-group loose"><div class="milestone-head"><div class="milestone-main"><strong>マイルストンなし</strong></div></div>${looseRows}</div>`
        : ""
      : looseRows;
    const canEditMilestones = project.status !== "completed" && project.status !== "dropped";
    const addMilestone = canEditMilestones
      ? `<details class="milestone-add"${state.editingMilestoneId === "new" ? " open" : ""}><summary>マイルストンを追加</summary>${milestoneEditForm(project)}</details>`
      : "";
    const queuedRows = `${groups}${looseGroup}`;
    // 完了Actionは新しい順に10件ずつ表示し、古い履歴まで「さらに表示」でたどれる（#140）。
    const shownCompleted = completed.slice(0, state.completedShown);
    const remainingCompleted = (project.counts?.done ?? completed.length) - shownCompleted.length;
    const completedRows =
      (project.counts?.done ?? completed.length)
        ? `<div class="action-list">${shownCompleted.map((action) => `<div class="action-row"><div><span>${escapeHtml(action.content)}</span>${todoLinkControls(action, project)}</div><small>${action.completedAt ? `完了 ${completedDate(action.completedAt)}` : "完了"}</small></div>`).join("")}</div>${
            remainingCompleted > 0
              ? `<div class="history-more"><button type="button" data-completed-more="${COMPLETED_PAGE}">さらに${Math.min(COMPLETED_PAGE, remainingCompleted)}件表示</button><button type="button" data-completed-more="all">すべて表示（残り${remainingCompleted}件）</button></div>`
              : ""
          }`
        : '<p class="empty-detail">完了したActionはまだありません。</p>';
    const relatedRows = project.items.length
      ? `<div class="related-list">${project.items.map(relatedItemRow).join("")}</div>`
      : '<p class="empty-detail">Inbox／Wantから関連づけた項目はまだありません。</p>';
    const otherActions = project.actions.filter((action) =>
      ["waiting", "cancelled"].includes(action.status),
    );
    const otherRows =
      otherActions.length || project.page?.historyHasMore
        ? `<section class="detail-section"><header><h3>確認待ち・取り消し済みのタスク</h3></header>${otherActions.map((action) => `<div class="action-row"><div>${escapeHtml(action.content)}${todoLinkControls(action, project)}</div><small>${action.status === "waiting" ? "確認待ち" : "取り消し"}</small></div>`).join("")}${project.page?.historyHasMore && remainingCompleted <= 0 ? '<button type="button" data-other-history-more>履歴をさらに表示</button>' : ""}</section>`
        : "";
    const meta = [
      `<span>状態: ${statusLabels[project.status]}</span>`,
      project.theme ? `<span>テーマ: ${escapeHtml(project.theme)}</span>` : null,
      project.targetOn
        ? `<span>目標日: ${escapeHtml(project.targetOn)}</span>`
        : "<span>目標日: 未設定</span>",
      project.reviewOn ? `<span>見直し: ${escapeHtml(project.reviewOn)}</span>` : null,
    ]
      .filter(Boolean)
      .join("");

    els.detailKicker.textContent = project.theme || "PROJECT";
    els.detailTitle.textContent = project.title;
    els.detailBody.innerHTML = `
      <section class="detail-summary"><p>${escapeHtml(project.outcome)}</p><div class="detail-meta">${meta}</div></section>
      <div class="detail-toolbar"><button id="detailEditButton" type="button">目標を編集</button></div>
      <section class="detail-section"><header><h3>現在のNext Action</h3></header>${current}</section>
      ${actionForm}${resumeForm}${reviewControls}
      <section class="detail-section"><header><h3>道筋とあとで行うAction</h3><small>マイルストン${project.milestones.length}件 · 候補${queued.length}件</small></header>${queuedRows}${bulkAddForm(project)}${addMilestone}</section>
      <section class="detail-section"><header><h3>目標を支える習慣</h3><button type="button" id="projectHabitsOpen">習慣と実績を確認</button></header></section>
      <section class="detail-section"><header><h3>関連するInbox／Wants</h3><small>${project.counts?.items ?? project.items.length}件</small></header>${relatedRows}${project.page?.itemsHasMore ? '<button type="button" data-items-more>さらに表示</button>' : ""}</section>
      <section class="detail-section" id="completedHistory"><header><h3>完了履歴</h3><small>${project.counts?.done ?? completed.length}件${remainingCompleted > 0 ? `中 ${shownCompleted.length}件を表示` : ""}</small></header>${completedRows}</section>`;
    els.detailBody.insertAdjacentHTML("beforeend", otherRows);
    els.detailBody
      .querySelector("[data-other-history-more]")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await loadMoreDetail(project, "history");
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });

    els.detailBody.querySelector("[data-items-more]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await loadMoreDetail(project, "items");
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    els.detailBody.querySelectorAll("[data-completed-more]").forEach((button) =>
      button.addEventListener("click", async () => {
        const previousShown = state.completedShown;
        state.completedShown =
          button.dataset.completedMore === "all" ? Infinity : state.completedShown + COMPLETED_PAGE;
        if (project.page?.historyHasMore) {
          button.disabled = true;
          try {
            if (!(await loadMoreDetail(project, "history", button.dataset.completedMore === "all")))
              state.completedShown = previousShown;
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        } else renderDetail(project);
      }),
    );
    document
      .getElementById("detailEditButton")
      ?.addEventListener("click", () => openProjectEditor(project));
    document
      .getElementById("detailResolveButton")
      ?.addEventListener("click", () => openResolve(project));
    document
      .getElementById("detailActionForm")
      ?.addEventListener("submit", (event) => saveProjectAction(event, project.id));
    document
      .getElementById("detailResumeForm")
      ?.addEventListener("submit", (event) => saveProjectAction(event, project.id, "resume"));
    document
      .getElementById("projectHabitsOpen")
      ?.addEventListener("click", () => openProjectHabits(project));
    els.detailBody
      .querySelectorAll("[data-review-mark]")
      .forEach((button) =>
        button.addEventListener("click", () => markProjectReviewed(project.id, button)),
      );
    els.detailBody.querySelectorAll("[data-action-schedule]").forEach((button) =>
      button.addEventListener("click", () =>
        openProjectSchedule(
          project,
          project.actions.find((action) => action.id === Number(button.dataset.actionSchedule)),
        ),
      ),
    );
    els.detailBody
      .querySelector("[data-capture-refresh]")
      ?.addEventListener("click", () => refreshCapture(project.id));
    document.getElementById("detailActionInput")?.addEventListener("input", (event) => {
      const value = { content: event.target.value, pending: null };
      state.captureDrafts[project.id] = value;
      saveCaptureDraft(project.id, value);
    });
    els.detailBody.querySelectorAll("[data-action-edit-open]").forEach((button) =>
      button.addEventListener("click", () => {
        state.editingActionId = Number(button.dataset.actionEditOpen);
        renderDetail(project);
        els.detailBody
          .querySelector(`[data-action-edit="${state.editingActionId}"] input[name=content]`)
          ?.focus();
      }),
    );
    els.detailBody.querySelectorAll("[data-action-edit-close]").forEach((button) =>
      button.addEventListener("click", () => {
        state.editingActionId = null;
        renderDetail(project);
      }),
    );
    els.detailBody.querySelectorAll("[data-action-edit]").forEach((form) =>
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const action = project.actions.find(
          (candidate) => candidate.id === Number(form.dataset.actionEdit),
        );
        updateAction(project.id, Number(form.dataset.actionEdit), "edit", {
          content: String(data.get("content") || ""),
          startOn: action?.linkedTodo
            ? (action.storedStartOn ?? null)
            : String(data.get("startOn") || "") || null,
          dueOn: action?.linkedTodo
            ? (action.storedDueOn ?? null)
            : String(data.get("dueOn") || "") || null,
          // マイルストンの欄がない（マイルストン未作成）ときは今の値を保つ
          milestoneId: data.has("milestoneId")
            ? Number(data.get("milestoneId")) || null
            : (action?.milestoneId ?? null),
        });
      }),
    );
    els.detailBody.querySelectorAll("[data-milestone-edit-open]").forEach((button) =>
      button.addEventListener("click", () => {
        state.editingMilestoneId = Number(button.dataset.milestoneEditOpen);
        renderDetail(project);
        els.detailBody
          .querySelector(`[data-milestone-form="${state.editingMilestoneId}"] input[name=title]`)
          ?.focus();
      }),
    );
    els.detailBody.querySelectorAll("[data-milestone-edit-close]").forEach((button) =>
      button.addEventListener("click", () => {
        state.editingMilestoneId = null;
        renderDetail(project);
      }),
    );
    els.detailBody.querySelectorAll("[data-milestone-form]").forEach((form) =>
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const id = form.dataset.milestoneForm;
        updateMilestone(
          project.id,
          id === "new" ? null : Number(id),
          id === "new" ? "create" : "edit",
          {
            title: String(data.get("title") || ""),
            dueOn: String(data.get("dueOn") || "") || null,
          },
        );
      }),
    );
    els.detailBody.querySelectorAll("[data-milestone-op]").forEach((button) =>
      button.addEventListener("click", () => {
        const operation = button.dataset.milestoneOp;
        if (
          operation === "delete" &&
          !window.confirm(
            "このマイルストンを削除しますか？タスクは「マイルストンなし」に残ります。",
          )
        )
          return;
        updateMilestone(project.id, Number(button.dataset.milestoneId), operation);
      }),
    );
    els.detailBody.querySelector(".bulk-add")?.addEventListener("toggle", (event) => {
      state.bulkOpen = event.currentTarget.open;
    });
    document
      .getElementById("bulkAddForm")
      ?.addEventListener("submit", (event) => saveBulkActions(event, project.id));
    els.detailBody.querySelectorAll("[data-action-op]").forEach((button) =>
      button.addEventListener("click", () => {
        const operation = button.dataset.actionOp;
        if (operation === "cancel" && !window.confirm("このActionを取り消しますか？")) return;
        updateAction(project.id, Number(button.dataset.actionId), operation);
      }),
    );
    els.detailBody
      .querySelector("#detailSkipButton")
      ?.addEventListener("click", () => openResolve(project, "cancelled"));
    els.detailBody
      .querySelectorAll("[data-action-todo-link]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openActionTodo(project.id, Number(button.dataset.actionTodoLink)),
        ),
      );
    els.detailBody
      .querySelectorAll("[data-action-todo-unlink]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          unlinkActionTodo(project.id, Number(button.dataset.actionTodoUnlink)),
        ),
      );
    els.detailBody.querySelectorAll("[data-project-item-action]").forEach((form) =>
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = form.querySelector("input");
        if (input?.value.trim())
          processRelatedItem(
            project.id,
            Number(form.dataset.projectItemAction),
            "action_source",
            input.value.trim(),
          );
      }),
    );
    els.detailBody.querySelectorAll("[data-project-item-treatment]").forEach((button) =>
      button.addEventListener("click", () => {
        processRelatedItem(
          project.id,
          Number(button.dataset.projectItemId),
          button.dataset.projectItemTreatment,
          null,
        );
      }),
    );
  }

  return { renderList, renderAll, renderDetail };
}
