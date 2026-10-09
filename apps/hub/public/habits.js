import { readApiJson } from "./api-client.js";

const state = {
  data: null,
  editing: null,
  saving: false,
  /** 履歴の期間（#141）。anchorがnullなら今週・今月。 */
  history: { period: "week", anchor: null, data: null, loading: false },
};

const ids = [
  "sourceBadge", "refreshButton", "addHabitButton", "completedToday", "remainingToday", "activeHabits",
  "loadingState", "errorState", "errorMessage", "retryButton", "habitContent", "todayList", "weekLabel", "weeklyList",
  "historyTable", "historyWeekly", "historyPrev", "historyNext", "historyLabel", "historyStatus", "manageList", "habitModal", "modalTitle", "modalClose", "habitForm", "habitName", "habitPurpose",
  "habitCadence", "statusField", "habitStatus", "formError", "cancelButton", "saveButton", "toast",
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const cadenceLabels = { daily: "毎日", weekdays: "平日", weekly: "毎週", flexible: "自由" };
const statusLabels = { active: "有効", paused: "休止", archived: "アーカイブ" };
const dayLabels = ["日", "月", "火", "水", "木", "金", "土"];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDay(value, includeYear = false) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", includeYear
    ? { year: "numeric", month: "long", day: "numeric", weekday: "short" }
    : { month: "numeric", day: "numeric" }).format(date);
}

function errorMessage(payload, fallback) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  return fallback;
}

function setSource(source, failed = false) {
  els.sourceBadge.className = `source-badge ${failed ? "error" : "live"}`;
  els.sourceBadge.lastElementChild.textContent = failed ? "接続エラー" : source?.state === "live" ? "Supabase同期" : "状態不明";
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3000);
}

function empty(message) {
  return `<div class="empty"><span>○</span><p>${escapeHtml(message)}</p></div>`;
}

function habitCard(habit, scope) {
  const weeklyDoneBeforeToday = scope === "weekly" && habit.completedThisWeek && !habit.completedToday;
  const completed = scope === "weekly" ? habit.completedThisWeek : habit.completedToday;
  const label = completed ? (weeklyDoneBeforeToday ? "今週完了" : "取り消す") : scope === "weekly" ? "今週できた" : "できた";
  const disabled = weeklyDoneBeforeToday ? "disabled" : "";
  const purpose = habit.purpose ? `<p>${escapeHtml(habit.purpose)}</p>` : "";
  const source = habit.sourceWantId ? `<span class="source-tag">Want #${habit.sourceWantId}</span>` : "";
  return `<article class="habit-card ${completed ? "completed" : ""}">
    <button class="check-button" type="button" data-log-id="${habit.id}" data-completed="${completed}" ${disabled} aria-label="${escapeHtml(habit.name)}を${completed ? "未実施に戻す" : "実施済みにする"}">${completed ? "✓" : "○"}</button>
    <div class="habit-copy"><div><h3>${escapeHtml(habit.name)}</h3><span class="cadence-tag">${escapeHtml(cadenceLabels[habit.cadence])}</span>${source}</div>${purpose}</div>
    <div class="card-actions"><button class="record-button" type="button" data-log-id="${habit.id}" data-completed="${completed}" ${disabled}>${label}</button><button class="edit-button" type="button" data-edit-id="${habit.id}" aria-label="${escapeHtml(habit.name)}を編集">編集</button></div>
  </article>`;
}

function renderToday(habits) {
  const items = habits.filter((habit) => habit.status === "active" && habit.cadence !== "weekly" && habit.eligibleToday);
  els.todayList.innerHTML = items.length ? items.map((habit) => habitCard(habit, "today")).join("") : empty("今日は対象のHabitがありません");
}

function renderWeekly(habits) {
  const items = habits.filter((habit) => habit.status === "active" && habit.cadence === "weekly" && state.data.today >= habit.startedOn);
  els.weeklyList.innerHTML = items.length ? items.map((habit) => habitCard(habit, "weekly")).join("") : empty("毎週のHabitはまだありません");
  const end = new Date(`${state.data.weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  els.weekLabel.textContent = `${formatDay(state.data.weekStart)}〜${formatDay(end.toISOString().slice(0, 10))}`;
}

function historyLabel(data) {
  if (data.period === "month") {
    const [year, month] = data.anchor.split("-");
    return `${year}年${Number(month)}月${data.nextAnchor ? "" : "（今月）"}`;
  }
  return `${formatDay(data.from)}〜${formatDay(data.to)}${data.nextAnchor ? "" : "（今週）"}`;
}

function habitHeader(habit) {
  const total = habit.target === null ? `${habit.done}${habit.unit}` : `${habit.done}/${habit.target}${habit.unit}`;
  const status = habit.status === "active" ? "" : ` · ${statusLabels[habit.status]}`;
  return `<th scope="row"><button type="button" data-edit-id="${habit.id}">${escapeHtml(habit.name)}</button><small>${escapeHtml(cadenceLabels[habit.cadence])}${status} · <b>${total}</b></small></th>`;
}

// 毎日・平日・自由は日ごと、毎週は週ごとの表にする。期間の集計（n/m日・n/m週）を名前の下に出す。
function renderHistory() {
  const data = state.history.data;
  if (!data) return;
  els.historyLabel.textContent = historyLabel(data);
  els.historyPrev.disabled = state.history.loading;
  els.historyNext.disabled = state.history.loading || !data.nextAnchor;
  document.querySelectorAll("[data-history-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.historyPeriod === data.period)));
  const daily = data.habits.filter((habit) => habit.days);
  const weekly = data.habits.filter((habit) => habit.weeks);
  if (!daily.length && !weekly.length) {
    els.historyTable.innerHTML = empty("この期間に表示できる履歴はありません");
    els.historyWeekly.innerHTML = "";
    return;
  }
  const dayHeadings = data.dates.map((date) => {
    const value = new Date(`${date}T00:00:00Z`);
    return `<th scope="col" class="${date === data.today ? "today" : ""}"><span>${dayLabels[value.getUTCDay()]}</span><b>${value.getUTCDate()}</b></th>`;
  }).join("");
  const dayRows = daily.map((habit) => `<tr>${habitHeader(habit)}${habit.days.map((day) => {
    const mark = day.completed ? "✓" : day.future ? "" : day.eligible ? "·" : "—";
    const className = day.completed ? "done" : day.future ? "future" : day.eligible ? "open" : "off";
    const label = day.completed ? "実施済み" : day.future ? "これから" : day.eligible ? "記録なし" : "対象外";
    return `<td class="${className}" aria-label="${day.date} ${label}">${mark}</td>`;
  }).join("")}</tr>`).join("");
  els.historyTable.innerHTML = daily.length
    ? `<table class="history-days ${data.period}"><thead><tr><th>Habit</th>${dayHeadings}</tr></thead><tbody>${dayRows}</tbody></table>`
    : "";
  const weekHeadings = data.weeks.map((monday) => `<th scope="col"><span>週</span><b>${formatDay(monday)}〜</b></th>`).join("");
  const weekRows = weekly.map((habit) => `<tr>${habitHeader(habit)}${habit.weeks.map((week) => {
    const mark = week.completed ? `✓<small>${formatDay(week.completedOn)}</small>` : week.eligible ? "·" : "—";
    const className = week.completed ? "done" : week.eligible ? "open" : "off";
    return `<td class="${className}" aria-label="${week.weekStart}の週 ${week.completed ? `${week.completedOn}に実施` : week.eligible ? "記録なし" : "対象外"}">${mark}</td>`;
  }).join("")}</tr>`).join("");
  els.historyWeekly.innerHTML = weekly.length
    ? `<table class="history-weeks"><thead><tr><th>毎週のHabit</th>${weekHeadings}</tr></thead><tbody>${weekRows}</tbody></table>`
    : "";
  bindContentActions(els.historyTable);
  bindContentActions(els.historyWeekly);
}

async function loadHistory() {
  state.history.loading = true;
  els.historyPrev.disabled = true;
  els.historyNext.disabled = true;
  els.historyStatus.hidden = true;
  const params = new URLSearchParams({ period: state.history.period });
  if (state.history.anchor) params.set("anchor", state.history.anchor);
  try {
    const response = await fetch(`/api/habit-history?${params}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "履歴を読み込めませんでした。"));
    state.history.data = payload;
  } catch (error) {
    els.historyStatus.textContent = error instanceof Error ? error.message : "履歴を読み込めませんでした。";
    els.historyStatus.hidden = false;
  } finally {
    state.history.loading = false;
    renderHistory();
    if (!state.history.data) { els.historyPrev.disabled = false; }
  }
}

function renderManage(habits) {
  const items = habits.filter((habit) => habit.status !== "active");
  els.manageList.innerHTML = items.length ? items.map((habit) => `<button type="button" data-edit-id="${habit.id}"><span><b>${escapeHtml(habit.name)}</b><small>${escapeHtml(cadenceLabels[habit.cadence])}</small></span><em class="status-${habit.status}">${escapeHtml(statusLabels[habit.status])}</em><i>編集</i></button>`).join("") : empty("休止中・アーカイブ済みのHabitはありません");
}

function bindContentActions(root = els.habitContent) {
  root.querySelectorAll("[data-log-id]").forEach((button) => button.addEventListener("click", () => toggleLog(Number(button.dataset.logId), button.dataset.completed !== "true", button)));
  root.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => {
    const habit = state.data.habits.find((item) => item.id === Number(button.dataset.editId));
    if (habit) openModal(habit);
  }));
}

function render() {
  const { summary, habits } = state.data;
  els.completedToday.textContent = summary.completedToday;
  els.remainingToday.textContent = summary.remainingToday;
  els.activeHabits.textContent = summary.active;
  renderToday(habits);
  renderWeekly(habits);
  renderManage(habits);
  bindContentActions(els.todayList);
  bindContentActions(els.weeklyList);
  bindContentActions(els.manageList);
}

async function load() {
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.habitContent.hidden = true;
  els.refreshButton.disabled = true;
  try {
    const response = await fetch("/api/habits", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "Habitを読み込めませんでした。"));
    state.data = payload;
    setSource(payload.source);
    render();
    els.habitContent.hidden = false;
    void loadHistory();
  } catch (error) {
    setSource(null, true);
    els.errorMessage.textContent = error instanceof Error ? error.message : "Habitを読み込めませんでした。";
    els.errorState.hidden = false;
  } finally {
    els.loadingState.hidden = true;
    els.refreshButton.disabled = false;
  }
}

async function toggleLog(id, completed, button) {
  button.disabled = true;
  try {
    const response = await fetch("/api/habit-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "habit-log" },
      body: JSON.stringify({ habitId: id, practicedOn: state.data.today, completed }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "実施記録を更新できませんでした。"));
    showToast(completed ? "実施済みとして記録しました。" : "今日の記録を取り消しました。");
    await load();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "実施記録を更新できませんでした。");
    button.disabled = false;
  }
}

function openModal(habit = null) {
  state.editing = habit || null;
  els.modalTitle.textContent = habit ? "習慣を編集" : "習慣を追加";
  els.habitName.value = habit?.name || "";
  els.habitPurpose.value = habit?.purpose || "";
  els.habitCadence.value = habit?.cadence || "daily";
  els.habitStatus.value = habit?.status || "active";
  els.statusField.hidden = !habit;
  els.saveButton.textContent = habit ? "変更を保存" : "登録する";
  els.formError.hidden = true;
  els.habitModal.hidden = false;
  els.habitName.focus();
}

function closeModal() {
  if (state.saving) return;
  els.habitModal.hidden = true;
  state.editing = null;
  els.habitForm.reset();
}

els.habitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  els.saveButton.disabled = true;
  els.formError.hidden = true;
  const editing = state.editing;
  const body = {
    ...(editing ? { id: editing.id } : {}),
    name: els.habitName.value,
    purpose: els.habitPurpose.value.trim() || null,
    cadence: els.habitCadence.value,
    ...(editing ? { status: els.habitStatus.value, original: { updatedAt: editing.updatedAt } } : {}),
  };
  try {
    const response = await fetch("/api/habits", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": editing ? "habit-update" : "habit-create" },
      body: JSON.stringify(body),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "Habitを保存できませんでした。"));
    state.saving = false;
    els.saveButton.disabled = false;
    closeModal();
    showToast(editing ? "Habitを更新しました。" : "Habitを追加しました。");
    await load();
  } catch (error) {
    els.formError.textContent = error instanceof Error ? error.message : "Habitを保存できませんでした。";
    els.formError.hidden = false;
    state.saving = false;
    els.saveButton.disabled = false;
  }
});

els.addHabitButton.addEventListener("click", () => openModal());
document.querySelectorAll("[data-history-period]").forEach((button) => button.addEventListener("click", () => {
  if (state.history.period === button.dataset.historyPeriod) return;
  state.history = { ...state.history, period: button.dataset.historyPeriod, anchor: null };
  void loadHistory();
}));
els.historyPrev.addEventListener("click", () => {
  if (!state.history.data) return;
  state.history.anchor = state.history.data.previousAnchor;
  void loadHistory();
});
els.historyNext.addEventListener("click", () => {
  if (!state.history.data?.nextAnchor) return;
  state.history.anchor = state.history.data.nextAnchor;
  void loadHistory();
});
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);
els.habitModal.addEventListener("click", (event) => { if (event.target === els.habitModal) closeModal(); });
els.refreshButton.addEventListener("click", load);
els.retryButton.addEventListener("click", load);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.habitModal.hidden) closeModal(); });

load();
