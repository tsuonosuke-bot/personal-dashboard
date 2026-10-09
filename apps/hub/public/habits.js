import { readApiJson } from "./api-client.js";

const state = {
  data: null,
  editing: null,
  saving: false,
  /** 履歴の期間（#141）。anchorがnullなら今週・今月。 */
  history: { period: "week", anchor: null, data: null, loading: false },
  /** 記録シートで開いている記録（#156）。 */
  sheet: null,
};

const ids = [
  "sourceBadge", "refreshButton", "addHabitButton", "completedToday", "remainingToday", "activeHabits",
  "loadingState", "errorState", "errorMessage", "retryButton", "habitContent", "todayList", "weekLabel", "weeklyList",
  "historyTable", "historyWeekly", "historyPrev", "historyNext", "historyLabel", "historyStatus", "manageList", "habitModal", "modalTitle", "modalClose", "habitForm", "habitName", "habitPurpose",
  "habitCadence", "targetField", "habitTarget", "statusField", "habitStatus", "formError", "cancelButton", "saveButton", "toast",
  "logSheet", "logSheetDate", "logSheetTitle", "logSheetClose", "logSheetForm", "logSheetStatus", "logSheetKindField",
"logSheetNoteField", "logSheetNote", "logSheetNoteView", "logSheetHint", "logSheetError",
  "logSheetCancel", "logSheetSave",
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

/** 毎週のHabitの今週の進み具合（#163）。例: 今週 2/3回 */
function weeklyProgress(habit) {
  const done = habit.weeklyCount >= habit.targetPerWeek;
  return `<span class="week-progress${done ? " done" : ""}">今週 ${habit.weeklyCount}/${habit.targetPerWeek}回${done ? " 達成" : ""}</span>`;
}

function habitCard(habit, scope) {
  // どの頻度でも、ボタンは今日の記録をつける・取り消す（毎週のHabitも1日1回ずつ数える）
  const completed = habit.completedToday;
  const label = completed ? "取り消す" : scope === "weekly" ? "今日やった" : "できた";
  // 今日休んだ（#164）。「できた」を押すと実施に切り替わる
  const rest = !completed && habit.skippedToday ? '<span class="skip-tag">今日は休み</span>' : "";
  const note = (habit.history || []).find((day) => day.date === state.data.today)?.note || null;
  const purpose = note ? `<p class="habit-note">メモ: ${escapeHtml(note)}</p>` : habit.purpose ? `<p>${escapeHtml(habit.purpose)}</p>` : "";
  const source = habit.sourceWantId ? `<span class="source-tag">Want #${habit.sourceWantId}</span>` : "";
  const cadence = scope === "weekly" ? `週${habit.targetPerWeek}回` : cadenceLabels[habit.cadence];
  return `<article class="habit-card ${completed ? "completed" : rest ? "skipped" : ""}">
    <button class="check-button" type="button" data-log-id="${habit.id}" data-completed="${completed}" aria-label="${escapeHtml(habit.name)}を${completed ? "未実施に戻す" : "実施済みにする"}">${completed ? "✓" : "○"}</button>
    <div class="habit-copy"><div><h3>${escapeHtml(habit.name)}</h3><span class="cadence-tag">${escapeHtml(cadence)}</span>${scope === "weekly" ? weeklyProgress(habit) : ""}${rest}${source}</div>${purpose}</div>
    <div class="card-actions"><button class="record-button" type="button" data-log-id="${habit.id}" data-completed="${completed}">${label}</button><button class="edit-button${note ? " has-note" : ""}" type="button" data-note-id="${habit.id}" aria-label="${escapeHtml(habit.name)}のメモ${note ? "（あり）" : ""}">メモ</button><button class="edit-button" type="button" data-edit-id="${habit.id}" aria-label="${escapeHtml(habit.name)}を編集">編集</button></div>
  </article>`;
}

function renderToday(habits) {
  const items = habits.filter((habit) => habit.status === "active" && habit.cadence !== "weekly" && habit.eligibleToday);
  els.todayList.innerHTML = items.length ? items.map((habit) => habitCard(habit, "today")).join("") : empty("今日は対象のHabitがありません");
}

/** 先週（月〜日）の結果（#163）。毎日・平日は日数、毎週は回数、自由は回数だけ。 */
function lastWeekCard(lastWeek) {
  if (!lastWeek?.habits?.length) return "";
  const achieved = lastWeek.habits.filter((habit) => habit.achieved === true).length;
  const counted = lastWeek.habits.filter((habit) => habit.achieved !== null).length;
  const rows = lastWeek.habits.map((habit) => {
    const value = `${habit.target === null ? `${habit.done}${habit.unit}` : `${habit.done}/${habit.target}${habit.unit}`}${habit.skipped ? ` · 休${habit.skipped}` : ""}`;
    return `<li class="${habit.achieved === true ? "done" : habit.achieved === false ? "missed" : ""}"><span>${escapeHtml(habit.name)}</span><b>${value}</b></li>`;
  }).join("");
  return `<div class="last-week"><div class="last-week-head"><strong>先週の結果</strong><small>${formatDay(lastWeek.from)}〜${formatDay(lastWeek.to)} · 目標達成 ${achieved}/${counted}</small></div><ul>${rows}</ul></div>`;
}

function renderWeekly(habits) {
  const items = habits.filter((habit) => habit.status === "active" && habit.cadence === "weekly" && state.data.today >= habit.startedOn);
  els.weeklyList.innerHTML = (items.length ? items.map((habit) => habitCard(habit, "weekly")).join("") : empty("毎週のHabitはまだありません"))
    + lastWeekCard(state.data.lastWeek);
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

function habitHeader(habit, table = "days") {
  // 毎週のHabitは、日ごとの表では期間内の回数、週ごとの表では目標を達成した週の数を出す（#163）
  const weeklyInDays = habit.cadence === "weekly" && table === "days";
  const total = weeklyInDays ? `${habit.dayCount}回`
    : habit.target === null ? `${habit.done}${habit.unit}` : `${habit.done}/${habit.target}${habit.unit}`;
  const status = habit.status === "active" ? "" : ` · ${statusLabels[habit.status]}`;
  const cadence = habit.cadence === "weekly" ? `週${habit.targetPerWeek}回` : cadenceLabels[habit.cadence];
  return `<th scope="row"><button type="button" data-edit-id="${habit.id}">${escapeHtml(habit.name)}</button><small>${escapeHtml(cadence)}${status} · <b>${total}</b></small></th>`;
}

// 日ごとの表に全Habitを並べ（毎週のHabitも記録した日に印）、毎週のHabitは週ごとの表で目標回数への到達も見せる。
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
    // 毎週のHabitはどの日もやらなくてよいので、記録のない日に「·」（記録なし）を出さない
    const free = habit.cadence === "weekly";
    const mark = day.completed ? "✓" : day.skipped ? "／" : day.future ? "" : day.eligible ? (free ? "" : "·") : "—";
    const className = `${day.completed ? "done" : day.skipped ? "skip" : day.future ? "future" : day.eligible ? (free ? "open free" : "open") : "off"}${day.late ? " late" : ""}${day.note ? " has-note" : ""}`;
    const label = `${day.completed ? "実施済み" : day.skipped ? "休んだ" : day.future ? "これから" : day.eligible ? "記録なし" : "対象外"}${day.late ? "（後から記録）" : ""}${day.note ? "・メモあり" : ""}`;
    // 直近7日の対象日と、実施済みの日は、シートで記録・メモを開ける（#155, #156）
    const editable = editableDate(habit.editableFrom, day.date) && day.eligible;
    if (editable || day.completed || day.skipped) {
      return `<td class="${className}${editable ? " editable" : " viewable"}"><button type="button" data-sheet-habit="${habit.id}" data-sheet-date="${day.date}" aria-label="${escapeHtml(habit.name)} ${day.date} ${label}。タップで${editable ? "記録・メモ" : "メモを見る"}">${mark}</button></td>`;
    }
    return `<td class="${className}" aria-label="${day.date} ${label}">${mark}</td>`;
  }).join("")}</tr>`).join("");
  els.historyTable.innerHTML = daily.length
    ? `<table class="history-days ${data.period}"><thead><tr><th>Habit</th>${dayHeadings}</tr></thead><tbody>${dayRows}</tbody></table>`
    : "";
  const weekHeadings = data.weeks.map((monday) => `<th scope="col"><span>週</span><b>${formatDay(monday)}〜</b></th>`).join("");
  const weekRows = weekly.map((habit) => `<tr>${habitHeader(habit, "weeks")}${habit.weeks.map((week) => {
    const mark = week.skipped ? `／<small>${week.count}/${habit.targetPerWeek}回</small>`
      : week.eligible || week.count ? `${week.completed ? "✓" : ""}<small>${week.count}/${habit.targetPerWeek}回</small>` : "—";
    const className = `${week.completed ? "done" : week.skipped ? "skip" : week.eligible ? "open" : "off"}${week.late ? " late" : ""}${week.note ? " has-note" : ""}`;
    const label = `${week.weekStart}の週 ${week.skipped ? `休みの週（${week.count}/${habit.targetPerWeek}回）`
      : week.eligible ? `${week.count}/${habit.targetPerWeek}回${week.completed ? "で達成" : ""}${week.late ? "（後から記録を含む）" : ""}` : "対象外"}`;
    return `<td class="${className}" aria-label="${label}">${mark}</td>`;
  }).join("")}</tr>`).join("");
  els.historyWeekly.innerHTML = weekly.length
    ? `<table class="history-weeks"><thead><tr><th>毎週のHabit</th>${weekHeadings}</tr></thead><tbody>${weekRows}</tbody></table>`
    : "";
  bindContentActions(els.historyTable);
  bindContentActions(els.historyWeekly);
  [els.historyTable, els.historyWeekly].forEach((root) => root.querySelectorAll("[data-sheet-habit]").forEach((button) => button.addEventListener("click", () => {
    const habit = state.history.data?.habits.find((item) => item.id === Number(button.dataset.sheetHabit));
    if (!habit) return;
    const day = habit.days.find((item) => item.date === button.dataset.sheetDate);
    if (day) openLogSheet({ habit, date: day.date, completed: day.completed, skipped: day.skipped, note: day.note });
  })));
}

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

/** 記録・取消できる日か（有効なHabitの、editableFrom〜今日）。 */
function editableDate(editableFrom, date) {
  return Boolean(editableFrom && date && date >= editableFrom && date <= state.data.today);
}

function selectedKind() {
  return els.logSheetForm.querySelector('input[name="logKind"]:checked')?.value || "none";
}

function updateLogSheetFields() {
  const sheet = state.sheet;
  const kind = selectedKind();
  els.logSheetNote.disabled = kind === "none";
  els.logSheetNote.placeholder = kind === "skip" ? "例：発熱のため休み" : "例：朝のうちに終えられた";
  els.logSheetHint.hidden = !(sheet.kind !== "none" && kind === "none");
  els.logSheetHint.textContent = sheet.note ? "保存すると、この日の記録とメモが消えます。" : "保存すると、この日の記録が消えます。";
}

/** 記録シート（#156）。直近7日なら実施・休んだ（#164）・取消とメモを保存でき、それより前は見るだけ。 */
function openLogSheet({ habit, date, completed, skipped = false, note }) {
  const editable = editableDate(habit.editableFrom, date);
  const kind = completed ? "done" : skipped ? "skip" : "none";
  state.sheet = { habitId: habit.id, date, kind, note: note || null, editable };
  els.logSheetTitle.textContent = habit.name;
  els.logSheetDate.textContent = formatDay(date, true);
  const status = completed ? "実施済み" : skipped ? "休んだ日" : "記録なし";
  els.logSheetStatus.textContent = editable ? status : `${status} · 7日より前の記録は見るだけです`;
  els.logSheetKindField.hidden = !editable;
  // 未記録の日を開いたときは「実施した」を選んだ状態から始める（記録するために開くことが多い）
  els.logSheetForm.querySelectorAll('input[name="logKind"]').forEach((input) => {
    input.checked = input.value === (kind === "none" ? "done" : kind);
  });
  els.logSheetNoteField.hidden = !editable;
  els.logSheetNote.value = note || "";
  els.logSheetNoteView.hidden = editable;
  els.logSheetNoteView.textContent = note || "メモはありません";
  els.logSheetSave.hidden = !editable;
  els.logSheetError.hidden = true;
  if (editable) updateLogSheetFields();
  else els.logSheetHint.hidden = true;
  els.logSheet.hidden = false;
  (editable ? els.logSheetNote : els.logSheetCancel).focus();
}

function closeLogSheet() {
  if (state.saving) return;
  els.logSheet.hidden = true;
  state.sheet = null;
}

async function saveLogSheet(event) {
  event.preventDefault();
  const sheet = state.sheet;
  if (!sheet?.editable || state.saving) return;
  const kind = selectedKind();
  const practicedOn = sheet.date;
  const note = els.logSheetNote.value.trim() || null;
  if (kind === "none" && sheet.kind === "none") { closeLogSheet(); return; }
  if (kind === sheet.kind && note === sheet.note) { closeLogSheet(); return; }
  const body = kind === "none"
    ? { habitId: sheet.habitId, practicedOn, completed: false }
    : { habitId: sheet.habitId, practicedOn, completed: true, kind, note };
  state.saving = true;
  els.logSheetSave.disabled = true;
  els.logSheetError.hidden = true;
  try {
    const response = await fetch("/api/habit-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "habit-log" },
      body: JSON.stringify(body),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "実施記録を保存できませんでした。"));
    state.saving = false;
    closeLogSheet();
    const day = practicedOn === state.data.today ? "今日" : formatDay(practicedOn);
    showToast(kind === "none" ? `${day}の記録を取り消しました。`
      : kind === sheet.kind ? "メモを保存しました。"
        : kind === "skip" ? `${day}は休んだ日にしました。` : `${day}の分を記録しました。`);
    await load();
  } catch (error) {
    els.logSheetError.textContent = error instanceof Error ? error.message : "実施記録を保存できませんでした。";
    els.logSheetError.hidden = false;
  } finally {
    state.saving = false;
    els.logSheetSave.disabled = false;
  }
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
  root.querySelectorAll("[data-log-id]").forEach((button) => button.addEventListener("click", () => toggleLog(
    Number(button.dataset.logId), button.dataset.completed !== "true", button, button.dataset.logDate || state.data.today,
  )));
  root.querySelectorAll("[data-note-id]").forEach((button) => button.addEventListener("click", () => {
    const habit = state.data.habits.find((item) => item.id === Number(button.dataset.noteId));
    if (!habit) return;
    const date = state.data.today;
    const note = (habit.history || []).find((day) => day.date === date)?.note || null;
    openLogSheet({ habit, date, completed: habit.completedToday, skipped: Boolean(habit.skippedToday), note });
  }));
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

async function toggleLog(id, completed, button, practicedOn = state.data.today) {
  button.disabled = true;
  try {
    const response = await fetch("/api/habit-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "habit-log" },
      body: JSON.stringify({ habitId: id, practicedOn, completed }),
    });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "実施記録を更新できませんでした。"));
    const day = practicedOn === state.data.today ? "今日" : formatDay(practicedOn);
    showToast(completed ? `${day}の分を実施済みとして記録しました。` : `${day}の記録を取り消しました。`);
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
  els.habitTarget.value = String(habit?.targetPerWeek || 1);
  els.targetField.hidden = els.habitCadence.value !== "weekly";
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
    targetPerWeek: els.habitCadence.value === "weekly" ? Number(els.habitTarget.value) : 1,
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
els.habitCadence.addEventListener("change", () => { els.targetField.hidden = els.habitCadence.value !== "weekly"; });
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
els.logSheetForm.addEventListener("submit", saveLogSheet);
els.logSheetForm.querySelectorAll('input[name="logKind"]').forEach((input) => input.addEventListener("change", updateLogSheetFields));
els.logSheetClose.addEventListener("click", closeLogSheet);
els.logSheetCancel.addEventListener("click", closeLogSheet);
els.logSheet.addEventListener("click", (event) => { if (event.target === els.logSheet) closeLogSheet(); });
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);
els.habitModal.addEventListener("click", (event) => { if (event.target === els.habitModal) closeModal(); });
els.refreshButton.addEventListener("click", load);
els.retryButton.addEventListener("click", load);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.logSheet.hidden) closeLogSheet();
  else if (!els.habitModal.hidden) closeModal();
});

load();
