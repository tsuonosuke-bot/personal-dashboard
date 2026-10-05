export interface TodoSchedule {
  allDay: boolean;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timeZone: string;
}

export interface CalendarTodo {
  id: number;
  title?: string;
  status: string;
  calendarState?: string;
  calendarEtag?: string | null;
  schedule?: TodoSchedule | null;
}

export type MovePlan =
  | { ok: true; schedule: TodoSchedule }
  | { ok: false; reason: "not-movable" | "invalid" | "same-date" | "past" };

export const WEEKDAYS: string[];
export function tokyoToday(now?: Date): string;
export function monthOf(date: string): string;
export function shiftMonth(month: string, delta: number): string;
export function monthLabel(month: string): string;
export function monthGrid(month: string): Array<Array<{ date: string; inMonth: boolean }>>;
export function groupByDate<T extends CalendarTodo>(items: T[]): Map<string, T[]>;
export function isDraggableTodo(item: CalendarTodo): boolean;
export function planMove(item: CalendarTodo, date: string, now?: Date): MovePlan;
export function formatMonthDay(date: string): string;
