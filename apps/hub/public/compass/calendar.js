// ToDoのカレンダー表示。月表示のカレンダーに予定を並べ、ドラッグ&ドロップで日付を変える。
import { loadTodos } from "./data.js";
import { openDrawer } from "./drawer.js";
import { escapeHtml, showToast, todoTiming } from "./format.js";
import { renderList } from "./list.js";
import { els, state } from "./state.js";
import { sendTodoUpdate } from "./todos.js";
import {
  WEEKDAYS,
  formatMonthDay,
  groupByDate,
  isDraggableTodo,
  monthGrid,
  monthLabel,
  monthOf,
  planMove,
  shiftMonth,
  tokyoToday,
} from "./calendar-grid.js";

const LAYOUT_KEY = "personal-hub.todo-layout";

/** 前回選んだ表示（リスト / カレンダー）を戻す。保存できない環境でも動くようにする。 */
export function restoreTodoLayout() {
  try {
    if (window.localStorage.getItem(LAYOUT_KEY) === "calendar") state.todoLayout = "calendar";
  } catch { /* 保存は任意 */ }
}

export function setTodoLayout(layout) {
  state.todoLayout = layout === "calendar" ? "calendar" : "list";
  try { window.localStorage.setItem(LAYOUT_KEY, state.todoLayout); } catch { /* 保存は任意 */ }
  renderList();
}

export function shiftCalendarMonth(delta) {
  state.calendarMonth = delta === 0 ? monthOf(tokyoToday()) : shiftMonth(state.calendarMonth || monthOf(tokyoToday()), delta);
  renderList();
}

function chipMarkup(item) {
  const schedule = item.schedule;
  const time = schedule.allDay ? "終日" : schedule.startTime;
  const draggable = isDraggableTodo(item);
  const tone = item.status === "pending" ? `todo-timing-${todoTiming(item)}` : "calendar-chip-closed";
  const label = `${time} ${item.title || "内容なし"}`;
  return `<button class="calendar-chip ${tone}" type="button" data-id="${item.id}" ${draggable ? 'draggable="true"' : ""}
    title="${escapeHtml(label)}${draggable ? "（ドラッグして日付を変更）" : ""}"><b>${escapeHtml(time)}</b><span>${escapeHtml(item.title || "内容なし")}</span></button>`;
}

function dayMarkup(day, groups, today) {
  const classes = ["calendar-day"];
  if (!day.inMonth) classes.push("is-outside");
  if (day.date === today) classes.push("is-today");
  if (day.date < today) classes.push("is-past");
  const number = Number(day.date.slice(8));
  const items = groups.get(day.date) || [];
  return `<div class="${classes.join(" ")}" data-date="${day.date}" role="group" aria-label="${escapeHtml(formatMonthDay(day.date))}">
    <span class="calendar-day-number">${number}</span>
    <div class="calendar-chips">${items.map(chipMarkup).join("")}</div>
  </div>`;
}

/** 表示中のToDoを月カレンダーとして els.cardList に描く。 */
export function renderTodoCalendar(items) {
  const today = tokyoToday();
  if (!state.calendarMonth) state.calendarMonth = monthOf(today);
  const month = state.calendarMonth;
  const groups = groupByDate(items);
  const weeks = monthGrid(month);
  els.cardList.innerHTML = `<section class="todo-calendar" aria-label="ToDoのカレンダー">
    <div class="calendar-head">
      <button class="filter-chip" type="button" data-calendar-nav="-1" aria-label="前の月">‹</button>
      <h3>${escapeHtml(monthLabel(month))}</h3>
      <button class="filter-chip" type="button" data-calendar-nav="1" aria-label="次の月">›</button>
      <button class="filter-chip" type="button" data-calendar-nav="0">今日</button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">${WEEKDAYS.map((name) => `<span>${name}</span>`).join("")}</div>
    <div class="calendar-grid">${weeks.flat().map((day) => dayMarkup(day, groups, today)).join("")}</div>
    <p class="calendar-hint">予定をドラッグすると、別の日へ移せます（時刻はそのまま・Google Calendarにも反映）。スマートフォンでは予定をタップして「日程を決め直す」から変更します。</p>
  </section>`;
  const root = els.cardList.querySelector(".todo-calendar");
  root.querySelectorAll("[data-calendar-nav]").forEach((button) => button.addEventListener("click", () => shiftCalendarMonth(Number(button.dataset.calendarNav))));
  root.querySelectorAll(".calendar-chip").forEach((chip) => {
    chip.addEventListener("click", () => openDrawer(Number(chip.dataset.id)));
    chip.addEventListener("dragstart", (event) => {
      state.calendarDragId = Number(chip.dataset.id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(state.calendarDragId));
      chip.classList.add("is-dragging");
    });
    chip.addEventListener("dragend", () => {
      state.calendarDragId = null;
      chip.classList.remove("is-dragging");
      root.querySelectorAll(".is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
    });
  });
  root.querySelectorAll(".calendar-day").forEach((cell) => {
    const droppable = () => state.calendarDragId !== null && !state.calendarBusy && cell.dataset.date >= today;
    cell.addEventListener("dragover", (event) => {
      if (!droppable()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      cell.classList.add("is-drop-target");
    });
    cell.addEventListener("dragleave", (event) => {
      if (!cell.contains(event.relatedTarget)) cell.classList.remove("is-drop-target");
    });
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      cell.classList.remove("is-drop-target");
      const id = state.calendarDragId;
      state.calendarDragId = null;
      if (id !== null) void moveTodoToDate(id, cell.dataset.date);
    });
  });
}

const MOVE_REFUSALS = {
  past: "過去の日付には移せません。",
  "not-movable": "このToDoはカレンダー上では移せません。詳細から確認してください。",
  invalid: "移動先の日付を確認できませんでした。",
};

/** ToDoを別の日へ移す。同じ日付なら何もしない。成功したらGoogle Calendarの予定も更新済み。 */
export async function moveTodoToDate(id, date) {
  const item = (state.data?.todos || []).find((todo) => todo.id === id);
  if (!item || state.calendarBusy) return;
  const plan = planMove(item, date);
  if (!plan.ok) {
    if (plan.reason !== "same-date") showToast(MOVE_REFUSALS[plan.reason] || MOVE_REFUSALS.invalid);
    return;
  }
  state.calendarBusy = true;
  els.cardList.querySelector(".todo-calendar")?.classList.add("is-busy");
  try {
    await sendTodoUpdate(item, "reschedule", { schedule: plan.schedule });
    showToast(`「${item.title || "ToDo"}」を${formatMonthDay(date)}に移しました。Google Calendarにも反映しています。`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "日程を変更できませんでした。");
  } finally {
    state.calendarBusy = false;
    // 成功でも失敗でも読み込み直す（失敗の原因が別画面での更新なら、最新の状態になる）。
    await loadTodos(false);
    if (state.view === "todos") renderList();
  }
}
