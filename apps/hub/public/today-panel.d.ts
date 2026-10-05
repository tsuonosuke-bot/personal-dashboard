export interface TodaySchedule {
  allDay: boolean;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timeZone: "Asia/Tokyo";
}

export interface TodayTodo {
  id: number;
  status: "pending" | "completed" | "skipped";
  title: string;
  schedule: TodaySchedule | null;
  calendarState: string;
  calendarEtag: string | null;
  note?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
}

export interface TodayHabit {
  id: number;
  name: string;
  cadence: "daily" | "weekdays" | "weekly" | "flexible";
  status: "active" | "paused" | "archived";
  startedOn: string;
  eligibleToday: boolean;
  completedToday: boolean;
  completedThisWeek: boolean;
  weeklyCompletedOn: string | null;
  history: Array<{ date: string; eligible: boolean; completed: boolean }>;
}

export interface TodayHabitsPayload {
  today: string;
  habits: TodayHabit[];
}

export interface TodayProjectAction {
  id: number;
  content: string;
  status: "next" | "queued" | "waiting" | "done" | "cancelled";
  completedAt: string | null;
  updatedAt: string;
}

export interface TodayProject {
  id: number;
  title: string;
  status: "active" | "waiting" | "on_hold" | "completed" | "dropped";
  targetOn: string | null;
  reviewOn: string | null;
  nextAction: TodayProjectAction | null;
  actions: TodayProjectAction[];
}

export interface TodayProjectsPayload {
  projects: TodayProject[];
}

export interface TodaySection<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
}

export const OVERDUE_PREVIEW: number;
export const SOON_DAYS: number;
export function escapeHtml(value: unknown): string;
export function todayInTokyo(now?: Date): string;
export function addDays(date: string, days: number): string;
export function daysBetween(from: string, to: string): number;
export function weekendDate(today: string): string;
export function shortDate(date: string): string;
export function todoTiming(item: TodayTodo, now?: Date): "overdue" | "today" | "upcoming";
export function groupTodos(items: TodayTodo[] | undefined, now?: Date): {
  overdue: TodayTodo[];
  today: TodayTodo[];
  soon: TodayTodo[];
  next: TodayTodo | null;
};
export function todoPill(item: TodayTodo, now?: Date): { tone: string; label: string };
export function scheduleLabel(schedule: TodaySchedule | null): string;
export function rescheduleRequest(
  item: TodayTodo,
  choice: "today" | "tomorrow" | "weekend",
  now?: Date,
): { disabled: string } | { command: "reschedule" | "recreate"; schedule: TodaySchedule };
export function todoRequestBody(item: TodayTodo, command: string, schedule?: TodaySchedule | null): Record<string, unknown>;
export function habitGroups(payload: TodayHabitsPayload): {
  daily: TodayHabit[];
  weekly: TodayHabit[];
  flexible: TodayHabit[];
  dailyDone: number;
  weeklyDone: number;
};
export function habitStreak(habit: TodayHabit): number;
export function habitPressed(habit: TodayHabit): boolean;
export function habitLocked(habit: TodayHabit, today: string): boolean;
export function habitNote(habit: TodayHabit, today: string): string;
export function projectRows(payload: TodayProjectsPayload, today: string): Array<{
  project: TodayProject;
  kind: "next" | "review";
  attention: "missing" | "overdue" | "review" | null;
  queued: TodayProjectAction[];
}>;
export function completedTodayCount(
  data: { todos: { items: TodayTodo[] } | null; habits: TodayHabitsPayload | null; projects: TodayProjectsPayload | null },
  now?: Date,
): number;
export function renderTodoSection(
  section: TodaySection<{ items: TodayTodo[] }>,
  options?: { compassUrl?: string; showAll?: boolean; now?: Date },
): string;
export function renderHabitSection(section: TodaySection<TodayHabitsPayload>): string;
export function renderProjectSection(
  section: TodaySection<TodayProjectsPayload>,
  options?: { resolvingActionId?: number | null; now?: Date },
): string;
export function createTodayPanel(root: HTMLElement): {
  load(): Promise<void[]>;
  setNavigation(navigation: { compass?: string } | null | undefined): void;
  isOpen(): boolean;
};
