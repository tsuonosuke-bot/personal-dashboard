import { requestApiJson } from "../api-client.js";
import { escapeHtml } from "../shared/html.js";

const cadences = { daily: "毎日", weekdays: "平日", weekly: "毎週", flexible: "自由" };
const statuses = { active: "継続中", paused: "休止中", archived: "アーカイブ" };
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const isStamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function habitProgress(habit) {
  const count =
    habit.cadence === "weekly"
      ? `今週 ${habit.weeklyCount}/${habit.targetPerWeek}回`
      : `今週 ${habit.weeklyCount}回`;
  const today = habit.completedToday
    ? "今日 実施済み"
    : habit.skippedToday
      ? "今日 休み"
      : "今日 未記録";
  return `${count} · ${today}${habit.cadence === "weekly" && habit.skippedThisWeek ? " · 今週の休みあり" : ""}`;
}

export function habitSourceUrl(projectId, habitId) {
  return `/habits/?projectId=${encodeURIComponent(projectId)}&habitId=${encodeURIComponent(habitId)}`;
}

function validHabit(habit) {
  return (
    habit &&
    positiveId(habit.id) &&
    typeof habit.name === "string" &&
    isStamp(habit.updatedAt) &&
    Object.hasOwn(cadences, habit.cadence) &&
    Object.hasOwn(statuses, habit.status) &&
    positiveId(habit.targetPerWeek) &&
    habit.targetPerWeek <= 7 &&
    nonnegative(habit.weeklyCount) &&
    typeof habit.completedToday === "boolean" &&
    typeof habit.skippedToday === "boolean" &&
    typeof habit.skippedThisWeek === "boolean"
  );
}

export function readProjectHabitsPayload(payload, projectId) {
  if (
    !payload ||
    payload.projectId !== projectId ||
    !isStamp(payload.projectUpdatedAt) ||
    payload.source?.state !== "live" ||
    !Array.isArray(payload.habits) ||
    !Array.isArray(payload.links) ||
    !Array.isArray(payload.relations) ||
    !payload.habits.every(validHabit) ||
    !payload.relations.every(
      (relation) =>
        positiveId(relation.habitId) &&
        typeof relation.linked === "boolean" &&
        isStamp(relation.updatedAt),
    ) ||
    !payload.links.every(
      (link) =>
        positiveId(link.habitId) &&
        isStamp(link.updatedAt) &&
        ((link.state === "missing" && link.habit === null) ||
          (link.state === "available" && validHabit(link.habit) && link.habit.id === link.habitId)),
    )
  ) {
    throw new Error("習慣の取得結果を確認できません。再読み込みしてください。");
  }
  const unique = (items, key) => new Set(items.map((item) => item[key])).size === items.length;
  if (
    !unique(payload.habits, "id") ||
    !unique(payload.links, "habitId") ||
    !unique(payload.relations, "habitId") ||
    payload.links.some(
      (link) =>
        !payload.relations.some(
          (relation) =>
            relation.habitId === link.habitId &&
            relation.linked &&
            relation.updatedAt === link.updatedAt,
        ),
    ) ||
    payload.relations.some(
      (relation) =>
        relation.linked && !payload.links.some((link) => link.habitId === relation.habitId),
    )
  ) {
    throw new Error("習慣の関連を確認できません。再読み込みしてください。");
  }
  return payload;
}

export function projectHabitSnapshot(data, habitId) {
  const habit = data.habits.find((item) => item.id === habitId);
  if (!habit) throw new Error("習慣を取得できません。再読み込みしてください。");
  return {
    projectId: data.projectId,
    projectUpdatedAt: data.projectUpdatedAt,
    habitId,
    habitUpdatedAt: habit.updatedAt,
    relationUpdatedAt:
      data.relations.find((relation) => relation.habitId === habitId)?.updatedAt ?? null,
  };
}

async function requestHabits(method, projectId, body) {
  return requestApiJson(
    method === "GET" ? `/api/project-habits?projectId=${projectId}` : "/api/project-habits",
    {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-Dashboard-Action": "project-habit-link" }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    },
    (payload) =>
      Object.assign(
        new Error(
          typeof payload?.error === "string" ? payload.error : "習慣の関連を変更できませんでした。",
        ),
        { code: payload?.code },
      ),
  );
}

/** DOM-free state/transport boundary, shared by the dialog and retry tests. */
export function createProjectHabitsModel({
  project,
  refreshProject,
  showToast,
  request = requestHabits,
  onChange = () => {},
}) {
  const state = {
    data: null,
    selectedId: null,
    busy: false,
    saving: false,
    loading: false,
    needsReload: false,
    error: "",
    notice: "",
    refreshParent: false,
    savedKnown: false,
  };
  const terminal = () =>
    ["completed", "dropped"].includes(state.data?.projectStatus ?? project.status);
  async function read() {
    state.data = readProjectHabitsPayload(await request("GET", project.id), project.id);
  }
  async function refresh() {
    if (state.refreshParent) {
      await refreshProject?.(project.id);
      state.refreshParent = false;
    }
  }
  return {
    state,
    terminal,
    select(habitId) {
      state.selectedId = positiveId(habitId) ? habitId : null;
      onChange();
    },
    async reload() {
      if (state.busy) return;
      state.busy = true;
      state.loading = true;
      state.error = "";
      onChange();
      try {
        await read();
        await refresh();
        state.needsReload = false;
      } catch (error) {
        state.data = null;
        state.needsReload = true;
        state.error =
          state.refreshParent && state.savedKnown
            ? "関連の変更は保存済みです。最新表示を取得できませんでした。再読み込みしてください。"
            : error.message || "習慣を取得できません。再読み込みしてください。";
      } finally {
        state.busy = false;
        state.loading = false;
        onChange();
      }
    },
    async changeLink(habitId, linked) {
      if (state.busy || state.needsReload || !state.data) return false;
      if (linked && terminal()) return false;
      state.busy = true;
      state.saving = true;
      state.error = "";
      state.notice = "";
      state.savedKnown = false;
      onChange();
      let saved = false;
      try {
        const input = projectHabitSnapshot(state.data, habitId);
        // A lost response may still have saved the relation. After explicit
        // reload refresh the parent fingerprint too, without replaying writes.
        state.refreshParent = true;
        const result = await request(linked ? "POST" : "DELETE", project.id, input);
        if (
          result?.projectId !== project.id ||
          result?.habitId !== habitId ||
          result?.linked !== linked
        ) {
          throw new Error("変更結果を確認できません。再読み込みして関連を確認してください。");
        }
        saved = true;
        state.savedKnown = true;
        state.notice = linked ? "関連づけを保存しました。" : "関連解除を保存しました。";
        await read();
        await refresh();
        state.needsReload = false;
        if (linked) state.selectedId = null;
        showToast?.(state.notice);
      } catch (error) {
        state.needsReload = true;
        state.error = saved
          ? "関連の変更は保存済みです。最新表示を取得できませんでした。再読み込みしてください。"
          : `${error.message || "変更結果を確認できませんでした。"} 再読み込みして関連を確認してから、必要な操作を選び直してください。`;
        // Keep selection and any saved result. No stale operation is replayed.
        if (saved) state.data = null;
      } finally {
        state.busy = false;
        state.saving = false;
        onChange();
      }
      return saved;
    },
  };
}

export async function openProjectHabits({ project, refreshProject, showToast }) {
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "project-todo-dialog";
  dialog.setAttribute("aria-labelledby", "projectHabitsTitle");
  dialog.innerHTML =
    '<header><h2 id="projectHabitsTitle">関連する習慣</h2><button type="button" data-close aria-label="閉じる">×</button></header><div data-body></div>';
  document.body.append(dialog);
  const body = dialog.querySelector("[data-body]");
  const model = createProjectHabitsModel({ project, refreshProject, showToast, onChange: render });
  dialog.querySelector("[data-close]").addEventListener("click", () => {
    if (!model.state.saving) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (model.state.saving) event.preventDefault();
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (previous?.isConnected) previous.focus();
    },
    { once: true },
  );
  function render() {
    if (!dialog.isConnected) return;
    const { data, selectedId, busy, saving, loading, needsReload, error, notice } = model.state;
    const linkedIds = new Set(data?.links.map((link) => link.habitId) || []);
    const candidates = (data?.habits || []).filter((habit) => !linkedIds.has(habit.id));
    const selected = candidates.find((habit) => habit.id === selectedId);
    body.innerHTML = `<div class="project-todo-form"><p>${escapeHtml(project.title)}</p>
      ${loading ? '<p role="status">習慣を読み込み中…</p>' : ""}
      ${notice ? `<p role="status">${escapeHtml(notice)}</p>` : ""}
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${
        data
          ? `<ul>${
              data.links
                .map((link) =>
                  link.state === "missing"
                    ? `<li><p>Habit #${link.habitId}：取得できません。関連を確認してください。</p></li>`
                    : `<li class="project-todo-preview"><p><a href="${habitSourceUrl(project.id, link.habitId)}">${escapeHtml(link.habit.name)}</a> · ${statuses[link.habit.status]}</p><p>${cadences[link.habit.cadence]}${link.habit.cadence === "weekly" ? `・週${link.habit.targetPerWeek}回` : ""} · ${escapeHtml(habitProgress(link.habit))}</p><button type="button" data-unlink="${link.habitId}" ${busy || needsReload ? "disabled" : ""}>関連を解除</button></li>`,
                )
                .join("") || "<li>関連する習慣はありません。</li>"
            }</ul>
        ${
          model.terminal()
            ? "<p>終了した目標の関連は確認・解除できます。</p>"
            : `<form class="project-todo-form"><label>既存のHabit<select name="habit" ${busy || needsReload ? "disabled" : ""}><option value="">選択してください</option>${candidates.map((habit) => `<option value="${habit.id}"${habit.id === selectedId ? " selected" : ""}>${escapeHtml(habit.name)}（${cadences[habit.cadence]}・${statuses[habit.status]}）</option>`).join("")}${selectedId && !selected ? `<option value="${selectedId}" selected disabled>選択していた習慣を確認してください</option>` : ""}</select></label>
          ${selected ? `<p class="project-todo-preview">${escapeHtml(habitProgress(selected))}</p>` : ""}
          <p>ほかの目標と同じHabitを共有できます。実施記録はHabitsで共通です。</p><button type="submit" class="primary" ${busy || needsReload || !selected ? "disabled" : ""}>関連づける</button></form>`
        }`
          : ""
      }
      <footer><button type="button" data-reload ${busy ? "disabled" : ""}>再読み込み</button><button type="button" data-done ${saving ? "disabled" : ""}>閉じる</button></footer></div>`;
    dialog.querySelector("[data-close]").disabled = saving;
    body.querySelector("[data-reload]").addEventListener("click", () => model.reload());
    body.querySelector("[data-done]").addEventListener("click", () => dialog.close());
    body
      .querySelector('[name="habit"]')
      ?.addEventListener("change", (event) => model.select(Number(event.target.value)));
    body.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (selected) void model.changeLink(selected.id, true);
    });
    body.querySelectorAll("[data-unlink]").forEach((button) =>
      button.addEventListener("click", () => {
        const habitId = Number(button.dataset.unlink);
        const name = data.links.find((link) => link.habitId === habitId)?.habit?.name || "この習慣";
        if (
          window.confirm(
            `「${name}」との関連を解除しますか？習慣と実施履歴、ほかの目標との関連は残ります。`,
          )
        ) {
          void model.changeLink(habitId, false);
        }
      }),
    );
  }
  dialog.showModal();
  await model.reload();
  return dialog;
}
