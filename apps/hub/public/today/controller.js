// Panelのイベント、非同期状態と更新後の再描画をつなぐ。
import { todayInTokyo, addDays, weekendDate, shortDate, groupTodos, scheduleLabel, rescheduleRequest, todoRequestBody, habitPressed } from "./model.js";
import { escapeHtml } from "../shared/html.js";
import { todoPill, createTodayView } from "./view.js";
import { requestJson, sendJson, SOURCES } from "./api.js";
import { todayElements, createTodayState } from "./state.js";
import { chooseTodoNextResolution } from "../shared/project-todo-link.js";

export function createTodayPanel(root) {
  const els = todayElements(document);
  const state = createTodayState();
  const { render } = createTodayView({ state, els });

  let toastTimer = null;
  let undoAction = null;

  // 手元で反映した変更より前に始まった読み込みの結果で、画面を巻き戻さないための番号。
  const localEdits = { todos: 0, habits: 0, projects: 0 };

  async function load(key) {
    state[key] = { ...state[key], status: "loading" };
    if (!state[key].data) render();
    const startedAt = localEdits[key];
    try {
      const data = await requestJson(SOURCES[key].url);
      if (localEdits[key] !== startedAt) return;
      state[key] = { status: "ready", data, error: null };
    } catch (error) {
      if (localEdits[key] !== startedAt) return;
      state[key] = { status: "error", data: state[key].data, error: error instanceof Error ? error.message : `${SOURCES[key].label}を取得できませんでした。` };
      if (state[key].data) showToast(`${SOURCES[key].label}を最新にできませんでした。`);
    }
    render();
  }

  function loadAll() {
    return Promise.all(Object.keys(SOURCES).map(load));
  }

  function showToast(message, undo = null) {
    els.toastText.textContent = message;
    undoAction = undo;
    els.toastUndo.hidden = !undo;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { els.toast.hidden = true; undoAction = null; }, undo ? 6000 : 4000);
  }

  function findTodo(id) {
    return state.todos.data?.items?.find((item) => item.id === id) || null;
  }

  async function updateTodo(item, command, schedule = null) {
    const send = (resolution = null) => sendJson("/api/scheduled-actions", "PATCH", "scheduled-todo-update", {
      ...todoRequestBody(item, command, schedule), ...(resolution ? { resolution } : {}),
    });
    let result;
    if (item.linkedProjectAction?.status === "next" && ["complete", "skip"].includes(command)) {
      const selected = await chooseTodoNextResolution(item.linkedProjectAction, command, async (resolution) => { result = await send(resolution); });
      if (!selected) throw new Error("変更をキャンセルしました。");
    } else result = await send();
    if (item.linkedProjectAction) void load("projects");
    return result;
  }

  // 一覧の取り直しはGoogleカレンダーの照会を伴って遅いので、保存の応答をすぐ画面に反映し、
  // 取り直しは裏で行う。
  function applyTodoResult(id, result) {
    const items = state.todos.data?.items;
    if (!items || !result || typeof result.updatedAt !== "string") {
      void load("todos");
      return;
    }
    localEdits.todos += 1;
    state.todos = {
      ...state.todos,
      status: "ready",
      data: {
        ...state.todos.data,
        items: items.map((item) => (item.id === id
          ? { ...item, status: result.status, completedAt: result.completedAt ?? null, note: result.note ?? null, updatedAt: result.updatedAt }
          : item)),
      },
    };
    render();
    void load("todos");
  }

  async function completeTodo(id, button) {
    const item = findTodo(id);
    if (!item) return;
    button.disabled = true;
    button.classList.add("is-on");
    try {
      applyTodoResult(id, await updateTodo(item, "complete"));
      showToast(`「${item.title}」を完了にしました`, item.linkedProjectAction ? null : async () => {
        const fresh = findTodo(id);
        if (!fresh || fresh.status !== "completed") throw new Error("ToDoの最新状態を確認できませんでした。");
        applyTodoResult(id, await updateTodo(fresh, "reopen"));
        return "ToDoを未実施に戻しました";
      });
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-on");
      showToast(error instanceof Error ? error.message : "ToDoを完了にできませんでした。");
    }
  }

  async function setHabit(habit, completed, practicedOn = state.habits.data.today, kind = null) {
    await sendJson("/api/habit-logs", "PATCH", "habit-log", { habitId: habit.id, practicedOn, completed, ...(kind ? { kind } : {}) });
  }

  async function backfillHabit(id, button, kind = "done") {
    const habit = state.habits.data?.habits?.find((candidate) => candidate.id === id);
    if (!habit) return;
    const yesterday = addDays(state.habits.data.today, -1);
    button.disabled = true;
    try {
      await setHabit(habit, true, yesterday, kind);
      await load("habits");
      showToast(kind === "skip" ? `${habit.name} は昨日休んだことにしました` : `${habit.name} を昨日の分として記録しました`, async () => {
        await setHabit(habit, false, yesterday);
        await load("habits");
        return `${habit.name} の昨日の記録を取り消しました`;
      });
    } catch (error) {
      button.disabled = false;
      showToast(error instanceof Error ? error.message : "Habitを記録できませんでした。");
    }
  }

  async function toggleHabit(id, button) {
    const habit = state.habits.data?.habits?.find((candidate) => candidate.id === id);
    if (!habit) return;
    const completed = !habitPressed(habit);
    button.disabled = true;
    button.setAttribute("aria-pressed", String(completed));
    try {
      await setHabit(habit, completed);
      await load("habits");
      showToast(completed ? `${habit.name} を記録しました` : `${habit.name} の記録を取り消しました`, completed
        ? async () => {
          await setHabit(habit, false);
          await load("habits");
          return `${habit.name} の記録を取り消しました`;
        }
        : null);
    } catch (error) {
      button.disabled = false;
      button.setAttribute("aria-pressed", String(!completed));
      showToast(error instanceof Error ? error.message : "Habitを記録できませんでした。");
    }
  }

  function findProjectAction(actionId) {
    for (const project of state.projects.data?.projects || []) {
      const action = (project.actions || []).find((candidate) => candidate.id === actionId);
      if (action) return { project, action };
    }
    return null;
  }

  /** あとで行うActionはその場で完了にする。Next Actionは残りがあれば先頭の候補へ進み、なければ次の一手を聞く。 */
  function completeProjectTask(actionId, button) {
    const found = findProjectAction(actionId);
    if (!found) return;
    if (found.action.linkedTodo && found.action.status === "next") {
      button.disabled = true;
      void updateTodo(found.action.linkedTodo, "complete").then(() => { void load("projects"); void load("todos"); showToast("ToDoとProjectタスクを完了しました。"); })
        .catch((error) => { button.disabled = false; showToast(error.message); });
      return;
    }
    if (found.action.status === "queued") {
      void completeQueuedAction(found, button);
      return;
    }
    const nextQueued = (found.project.actions || []).find((action) => action.status === "queued");
    if (nextQueued) {
      void resolveProject(actionId, { nextActionId: nextQueued.id }, button);
      return;
    }
    state.resolvingActionId = state.resolvingActionId === actionId ? null : actionId;
    render();
    if (state.resolvingActionId) root.querySelector(".today-resolver input")?.focus();
  }

  async function completeQueuedAction(found, button) {
    button.disabled = true;
    try {
      const payload = await sendJson("/api/project-actions", "PUT", "project-action-update", {
        actionId: found.action.id,
        originalUpdatedAt: found.action.updatedAt,
        operation: "complete",
        content: null,
        dueOn: null,
        startOn: null,
        ...(found.action.linkedTodo ? { todo: { id: found.action.linkedTodo.id, updatedAt: found.action.linkedTodo.updatedAt, status: found.action.linkedTodo.status } } : {}),
      });
      state.projects = { status: "ready", data: payload, error: null };
      render();
      showToast(`「${found.action.content}」を完了しました`);
    } catch (error) {
      button.disabled = false;
      button.focus();
      showToast(error instanceof Error ? error.message : "Projectを更新できませんでした。");
    }
  }

  async function resolveProject(actionId, { nextActionId = null, nextActionContent = null }, control) {
    const found = findProjectAction(actionId);
    if (!found) return;
    const controls = [...root.querySelectorAll(".today-resolver button, .today-resolver input"), control].filter(Boolean);
    controls.forEach((element) => { element.disabled = true; });
    try {
      const payload = await sendJson("/api/project-actions", "PATCH", "project-action-resolve", {
        actionId,
        originalUpdatedAt: found.action.updatedAt,
        resolution: "continue",
        nextActionId,
        nextActionContent,
        waitingFor: null,
        reviewOn: null,
        ...(found.action.linkedTodo ? { todo: { id: found.action.linkedTodo.id, updatedAt: found.action.linkedTodo.updatedAt, status: found.action.linkedTodo.status } } : {}),
      });
      state.projects = { status: "ready", data: payload, error: null };
      state.resolvingActionId = null;
      render();
      const next = nextActionContent || found.project.actions.find((action) => action.id === nextActionId)?.content || "";
      showToast(`「${found.action.content}」を完了。次の一手は「${next}」です`);
    } catch (error) {
      controls.forEach((element) => { element.disabled = false; });
      control?.focus();
      showToast(error instanceof Error ? error.message : "Projectを更新できませんでした。");
    }
  }

  // ---------- 期限切れの見直し ----------

  function openTriage(trigger) {
    const overdue = groupTodos(state.todos.data?.items).overdue;
    if (!overdue.length) return;
    // 古いものから順に決める。
    const ids = [...overdue].reverse().map((item) => item.id);
    state.triage = { ids, index: 0, trigger, results: { done: 0, moved: 0, skipped: 0, later: 0 }, changed: false };
    els.sheet.hidden = false;
    document.body.classList.add("modal-open");
    showTriageStep();
  }

  function showTriageStep() {
    const triage = state.triage;
    const item = findTodo(triage.ids[triage.index]);
    if (!item) {
      nextTriageStep();
      return;
    }
    const now = new Date();
    const pill = todoPill(item, now);
    const today = todayInTokyo(now);
    els.sheetStep.textContent = `期限切れの見直し ${triage.index + 1} / ${triage.ids.length}`;
    els.sheetBar.style.width = `${(triage.index / triage.ids.length) * 100}%`;
    els.sheetTitle.textContent = item.title;
    els.sheetMeta.innerHTML = `<span class="today-pill ${pill.tone}">${escapeHtml(pill.label)}</span><span>予定 ${escapeHtml(scheduleLabel(item.schedule))}</span>`;
    const options = {
      today: rescheduleRequest(item, "today", now),
      tomorrow: rescheduleRequest(item, "tomorrow", now),
      weekend: rescheduleRequest(item, "weekend", now),
    };
    const notice = Object.values(options).find((option) => option.disabled)?.disabled || "";
    els.sheetNotice.textContent = notice;
    els.sheetNotice.hidden = !notice;
    const dateButton = (key, label, date) => `<button type="button" data-triage="${key}"${options[key].disabled ? " disabled" : ""}>${label}${date ? `<small>${escapeHtml(shortDate(date))}</small>` : ""}</button>`;
    els.sheetActions.innerHTML = `
      <button class="primary" type="button" data-triage="complete">やった（完了にする）</button>
      ${dateButton("today", "今日やる", null)}
      ${dateButton("tomorrow", "明日", addDays(today, 1))}
      ${dateButton("weekend", "週末", weekendDate(today))}
      <button type="button" data-triage="skip">やめる<small>見送りにする</small></button>
      <button class="subtle" type="button" data-triage="later">あとで決める</button>`;
    els.sheetActions.querySelector(".primary").focus();
  }

  function nextTriageStep() {
    state.triage.index += 1;
    if (state.triage.index >= state.triage.ids.length) closeTriage();
    else showTriageStep();
  }

  async function chooseTriage(choice) {
    const triage = state.triage;
    const item = findTodo(triage.ids[triage.index]);
    if (!item) return;
    if (choice === "later") {
      triage.results.later += 1;
      nextTriageStep();
      return;
    }
    const buttons = els.sheetActions.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    els.sheetNotice.hidden = true;
    try {
      if (choice === "complete" || choice === "skip") {
        await updateTodo(item, choice);
        triage.results[choice === "complete" ? "done" : "skipped"] += 1;
      } else {
        const request = rescheduleRequest(item, choice);
        if (request.disabled) throw new Error(request.disabled);
        await updateTodo(item, request.command, request.schedule);
        triage.results.moved += 1;
      }
      triage.changed = true;
      nextTriageStep();
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      els.sheetNotice.textContent = error instanceof Error ? error.message : "ToDoを更新できませんでした。";
      els.sheetNotice.hidden = false;
    }
  }

  function closeTriage() {
    const triage = state.triage;
    if (!triage) return;
    state.triage = null;
    els.sheet.hidden = true;
    document.body.classList.remove("modal-open");
    if (triage.trigger?.isConnected) triage.trigger.focus();
    const { done, moved, skipped } = triage.results;
    if (triage.changed) {
      void load("todos");
      showToast(`見直しました：完了${done}・日程変更${moved}・見送り${skipped}`);
    }
  }

  // ---------- イベント ----------

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.todoComplete) void completeTodo(Number(button.dataset.todoComplete), button);
    else if (button.dataset.habitToggle) void toggleHabit(Number(button.dataset.habitToggle), button);
    else if (button.dataset.habitBackfill) void backfillHabit(Number(button.dataset.habitBackfill), button);
    else if (button.dataset.habitBackfillSkip) void backfillHabit(Number(button.dataset.habitBackfillSkip), button, "skip");
    else if (button.dataset.projectTask) completeProjectTask(Number(button.dataset.projectTask), button);
    else if ("projectCancel" in button.dataset) {
      const actionId = state.resolvingActionId;
      state.resolvingActionId = null;
      render();
      root.querySelector(`[data-project-task="${actionId}"]`)?.focus();
    } else if ("projectMore" in button.dataset) {
      state.showAllProjects = true;
      render();
    } else if ("todoMore" in button.dataset) {
      state.showAllTodos = true;
      render();
    } else if (button.id === "todayTriageButton") openTriage(button);
    else if (button.dataset.todayRetry) void load(button.dataset.todayRetry);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.dataset.projectNext) return;
    event.preventDefault();
    const content = form.elements.content.value.trim();
    if (!content) return;
    void resolveProject(Number(form.dataset.projectNext), { nextActionContent: content }, form.elements.content);
  });

  els.sheetActions.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-triage]") : null;
    if (button && !button.disabled) void chooseTriage(button.dataset.triage);
  });
  els.sheetClose.addEventListener("click", closeTriage);
  els.sheet.addEventListener("click", (event) => { if (event.target === els.sheet) closeTriage(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.triage) return;
    event.stopImmediatePropagation();
    closeTriage();
  });
  els.toastUndo.addEventListener("click", async () => {
    const undo = undoAction;
    undoAction = null;
    els.toast.hidden = true;
    if (!undo) return;
    try {
      showToast(await undo());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "取り消せませんでした。");
    }
  });

  return {
    load: loadAll,
    setNavigation(navigation) {
      state.compassUrl = navigation?.compass || "/compass/";
      els.todoLink.href = `${state.compassUrl}?view=todos`;
      render();
    },
    isOpen: () => Boolean(state.triage),
  };
}
