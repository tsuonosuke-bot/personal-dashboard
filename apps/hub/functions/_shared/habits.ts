import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

export const HABIT_CADENCES = ["daily", "weekdays", "weekly", "flexible"] as const;
export const HABIT_STATUSES = ["active", "paused", "archived"] as const;

type HabitCadence = typeof HABIT_CADENCES[number];
type HabitStatus = typeof HABIT_STATUSES[number];

interface HabitRow {
  id?: unknown;
  source_want_id?: unknown;
  name?: unknown;
  purpose?: unknown;
  cadence?: unknown;
  status?: unknown;
  started_on?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface HabitLogRow {
  id?: unknown;
  habit_id?: unknown;
  practiced_on?: unknown;
  note?: unknown;
  created_at?: unknown;
}

interface Connection {
  url: URL;
  key: string;
}

export interface HabitCreateInput {
  name: string;
  purpose: string | null;
  cadence: HabitCadence;
}

export interface HabitUpdateInput extends HabitCreateInput {
  id: number;
  status: HabitStatus;
  original: { updatedAt: string };
}

export interface HabitLogInput {
  habitId: number;
  practicedOn: string;
  completed: boolean;
  /** ひとことメモ（#156）。undefinedなら変えない。空文字はnullとして消す。 */
  note?: string | null;
}

export const MAX_NOTE_CHARS = 2000;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const PAGE_SIZE = 1000;
/** 記録漏れを後から直せる日数（#155）。今日から7日前まで。 */
export const BACKFILL_DAYS = 7;
const MAX_REQUEST_CHARS = 8_000;
const HABIT_SELECT = "id,source_want_id,name,purpose,cadence,status,started_on,created_at,updated_at";
const LOG_SELECT = "id,habit_id,practiced_on,note,created_at";
const CADENCES = new Set<string>(HABIT_CADENCES);
const STATUSES = new Set<string>(HABIT_STATUSES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[]): boolean {
  return Object.keys(value).every((key) => required.includes(key))
    && required.every((key) => key in value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function plainDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number.isNaN(Date.parse(value))) return null;
  // Keep PostgreSQL's fractional-second precision intact for optimistic locking.
  return value;
}

function connection(env: DashboardEnv): Connection {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { url, key };
}

function headers(info: Connection, extra: Record<string, string> = {}): Record<string, string> {
  return supabaseHeaders(info.key, extra);
}

function responseError(response: Response, table: string): DashboardError {
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${table} returned ${response.status}.`);
}

async function fetchRows(
  info: Connection,
  table: "habits" | "habit_logs",
  select: string,
  configure?: (endpoint: URL) => void,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, info.url);
    endpoint.searchParams.set("select", select);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    configure?.(endpoint);
    let response: Response;
    try {
      response = await fetch(endpoint, { headers: headers(info) });
    } catch {
      throw new DashboardError("SUPABASE_UNAVAILABLE", `Could not reach ${table}.`);
    }
    if (!response.ok) throw responseError(response, table);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function todayInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 実施日より後の日（JST）に作られた記録は「後から記録」とみなす。 */
function loggedLate(practicedOn: string, createdAt: string | null): boolean {
  return createdAt !== null && todayInTokyo(new Date(createdAt)) > practicedOn;
}

/** 記録・取消できる最も古い日。開始日より前と、今日から BACKFILL_DAYS 日より前は変えられない。 */
export function editableFrom(today: string, startedOn: string): string {
  const limit = addDays(today, -BACKFILL_DAYS);
  return startedOn > limit ? startedOn : limit;
}

export function mondayOf(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

function trackingDates(today: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
}

function isEligible(cadence: HabitCadence, date: string, startedOn: string): boolean {
  if (date < startedOn) return false;
  if (cadence === "weekdays") {
    const weekday = dayOfWeek(date);
    return weekday >= 1 && weekday <= 5;
  }
  return cadence !== "weekly";
}

export function normalizeHabits(habitRows: HabitRow[], logRows: HabitLogRow[], now = new Date()) {
  const today = todayInTokyo(now);
  const weekStart = mondayOf(today);
  const dates = trackingDates(today);
  const logs = logRows.map((row) => ({
    id: integer(row.id),
    habitId: integer(row.habit_id),
    practicedOn: plainDate(row.practiced_on),
    note: text(row.note) || null,
    createdAt: isoDate(row.created_at),
  })).filter((row) => row.id !== null && row.habitId !== null && row.practicedOn !== null);
  const logsByHabit = new Map<number, typeof logs>();
  logs.forEach((log) => {
    const current = logsByHabit.get(log.habitId as number) || [];
    current.push(log);
    logsByHabit.set(log.habitId as number, current);
  });

  const habits = habitRows.map((row) => {
    const id = integer(row.id);
    const cadence = CADENCES.has(text(row.cadence)) ? text(row.cadence) as HabitCadence : null;
    const status = STATUSES.has(text(row.status)) ? text(row.status) as HabitStatus : null;
    const startedOn = plainDate(row.started_on) || today;
    if (id === null || cadence === null || status === null) return null;
    const habitLogs = logsByHabit.get(id) || [];
    const completedDates = new Set(habitLogs.map((log) => log.practicedOn as string));
    const notes = new Map(habitLogs.filter((log) => log.note).map((log) => [log.practicedOn as string, log.note as string]));
    const lateDates = new Set(habitLogs
      .filter((log) => loggedLate(log.practicedOn as string, log.createdAt))
      .map((log) => log.practicedOn as string));
    const completedToday = completedDates.has(today);
    const weeklyLog = habitLogs.find((log) => (log.practicedOn as string) >= weekStart && (log.practicedOn as string) <= today) || null;
    return {
      id,
      sourceWantId: integer(row.source_want_id),
      name: text(row.name),
      purpose: text(row.purpose) || null,
      cadence,
      status,
      startedOn,
      createdAt: isoDate(row.created_at),
      updatedAt: isoDate(row.updated_at),
      eligibleToday: isEligible(cadence, today, startedOn),
      completedToday,
      completedThisWeek: weeklyLog !== null,
      weeklyCompletedOn: weeklyLog?.practicedOn || null,
      editableFrom: editableFrom(today, startedOn),
      history: dates.map((date) => ({
        date,
        eligible: isEligible(cadence, date, startedOn),
        completed: completedDates.has(date),
        late: lateDates.has(date),
        note: notes.get(date) ?? null,
      })),
    };
  }).filter((habit) => habit !== null);

  const active = habits.filter((habit) => habit.status === "active");
  const dueToday = active.filter((habit) =>
    habit.cadence === "weekly"
      ? !habit.completedThisWeek && today >= habit.startedOn
      : habit.cadence !== "flexible" && habit.eligibleToday && !habit.completedToday
  );
  const completedToday = active.filter((habit) => habit.completedToday).length;

  return {
    app: { appId: "personal-dashboard-habits", version: "1.0.0", mode: "read-write" },
    source: { system: "supabase", state: "live", fetchedAt: now.toISOString() },
    today,
    weekStart,
    dates,
    summary: {
      total: habits.length,
      active: active.length,
      completedToday,
      remainingToday: dueToday.length,
    },
    habits,
  };
}

export async function loadHabits(env: DashboardEnv, now = new Date()) {
  const info = connection(env);
  const today = todayInTokyo(now);
  const from = addDays(today, -6) < mondayOf(today) ? addDays(today, -6) : mondayOf(today);
  const [habits, logs] = await Promise.all([
    fetchRows(info, "habits", HABIT_SELECT, (endpoint) => endpoint.searchParams.set("order", "created_at.asc,id.asc")),
    fetchRows(info, "habit_logs", LOG_SELECT, (endpoint) => {
      endpoint.searchParams.set("practiced_on", `gte.${from}`);
      endpoint.searchParams.append("practiced_on", `lte.${today}`);
      endpoint.searchParams.set("order", "practiced_on.asc,id.asc");
    }),
  ]);
  return normalizeHabits(habits as HabitRow[], logs as HabitLogRow[], now);
}

export type HabitHistoryPeriod = "week" | "month";

export interface HabitHistoryQuery {
  period: HabitHistoryPeriod;
  /** week: その週の任意の日（月曜始まりに丸める）。month: YYYY-MM。 */
  anchor: string;
}

/** 履歴の期間指定を読む。未指定なら今週。未来の期間と2000年より前は受け付けない。 */
export function readHabitHistoryQuery(url: URL, now = new Date()): ValidationResult<HabitHistoryQuery> {
  const today = todayInTokyo(now);
  const period = url.searchParams.get("period") ?? "week";
  const rawAnchor = url.searchParams.get("anchor");
  if (period === "week") {
    const anchor = rawAnchor === null ? today : plainDate(rawAnchor);
    if (!anchor || Number.isNaN(Date.parse(`${anchor}T00:00:00Z`)) || anchor < "2000-01-01" || mondayOf(anchor) > mondayOf(today)) {
      return { ok: false, status: 400, error: "週の指定が正しくありません。" };
    }
    return { ok: true, value: { period, anchor: mondayOf(anchor) } };
  }
  if (period === "month") {
    const anchor = rawAnchor ?? today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchor) || anchor < "2000-01" || anchor > today.slice(0, 7)) {
      return { ok: false, status: 400, error: "月の指定が正しくありません。" };
    }
    return { ok: true, value: { period, anchor } };
  }
  return { ok: false, status: 400, error: "期間の指定が正しくありません。" };
}

function monthEnd(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

function rangeDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** 期間の日付（週は月〜日、月はその月）と、期間に重なる週（月曜日）を返す。 */
export function habitHistoryRange(query: HabitHistoryQuery) {
  const from = query.period === "week" ? query.anchor : `${query.anchor}-01`;
  const to = query.period === "week" ? addDays(query.anchor, 6) : monthEnd(query.anchor);
  const weeks: string[] = [];
  for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) weeks.push(monday);
  return { from, to, dates: rangeDates(from, to), weeks };
}

/**
 * 期間指定の履歴（#141）。毎日・平日は日ごと、毎週は週ごと、自由頻度は回数で集計する。
 * 今日より後と開始日より前は対象外にし、分母に入れない。
 */
export function normalizeHabitHistory(habitRows: HabitRow[], logRows: HabitLogRow[], query: HabitHistoryQuery, now = new Date()) {
  const today = todayInTokyo(now);
  const { from, to, dates, weeks } = habitHistoryRange(query);
  const logsByHabit = new Map<number, Set<string>>();
  const lateByHabit = new Map<number, Set<string>>();
  const notesByHabit = new Map<number, Map<string, string>>();
  for (const row of logRows) {
    const habitId = integer(row.habit_id);
    const practicedOn = plainDate(row.practiced_on);
    if (habitId === null || practicedOn === null) continue;
    const current = logsByHabit.get(habitId) ?? new Set<string>();
    current.add(practicedOn);
    logsByHabit.set(habitId, current);
    const note = text(row.note).trim();
    if (note) {
      const notes = notesByHabit.get(habitId) ?? new Map<string, string>();
      notes.set(practicedOn, note);
      notesByHabit.set(habitId, notes);
    }
    if (loggedLate(practicedOn, isoDate(row.created_at))) {
      const late = lateByHabit.get(habitId) ?? new Set<string>();
      late.add(practicedOn);
      lateByHabit.set(habitId, late);
    }
  }

  const habits = habitRows.map((row) => {
    const id = integer(row.id);
    const cadence = CADENCES.has(text(row.cadence)) ? text(row.cadence) as HabitCadence : null;
    const status = STATUSES.has(text(row.status)) ? text(row.status) as HabitStatus : null;
    if (id === null || cadence === null || status === null) return null;
    const startedOn = plainDate(row.started_on) || today;
    const practiced = logsByHabit.get(id) ?? new Set<string>();
    const late = lateByHabit.get(id) ?? new Set<string>();
    const notes = notesByHabit.get(id) ?? new Map<string, string>();
    const inRange = [...practiced].filter((date) => date >= from && date <= to);
    // アーカイブ済みは、期間内に記録があるときだけ出す
    if (status === "archived" && inRange.length === 0) return null;
    // 記録・取消できるのは有効なHabitの、開始日以降かつ今日から7日前まで（#155）
    const base = { id, name: text(row.name), cadence, status, startedOn, editableFrom: status === "active" ? editableFrom(today, startedOn) : null };
    if (cadence === "weekly") {
      const weekRows = weeks.map((monday) => {
        const sunday = addDays(monday, 6);
        const completedOn = [...practiced].filter((date) => date >= monday && date <= sunday).sort()[0] ?? null;
        const eligible = monday <= today && sunday >= startedOn;
        return { weekStart: monday, eligible, completed: completedOn !== null, completedOn, late: completedOn !== null && late.has(completedOn), note: completedOn ? notes.get(completedOn) ?? null : null };
      });
      const eligibleWeeks = weekRows.filter((week) => week.eligible);
      return { ...base, weeks: weekRows, days: null, done: eligibleWeeks.filter((week) => week.completed).length, target: eligibleWeeks.length, unit: "週" };
    }
    const dayRows = dates.map((date) => {
      const future = date > today;
      const eligible = !future && isEligible(cadence, date, startedOn);
      return { date, eligible, future, completed: practiced.has(date), late: late.has(date), note: notes.get(date) ?? null };
    });
    const done = dayRows.filter((day) => day.completed).length;
    return {
      ...base,
      days: dayRows,
      weeks: null,
      done,
      // 自由頻度は分母を持たない
      target: cadence === "flexible" ? null : dayRows.filter((day) => day.eligible).length,
      unit: cadence === "flexible" ? "回" : "日",
    };
  }).filter((habit) => habit !== null);

  return {
    period: query.period,
    anchor: query.anchor,
    from,
    to,
    today,
    dates,
    weeks,
    previousAnchor: query.period === "week" ? addDays(query.anchor, -7) : addDays(`${query.anchor}-01`, -1).slice(0, 7),
    nextAnchor: query.period === "week"
      ? (addDays(query.anchor, 7) <= today ? addDays(query.anchor, 7) : null)
      : (addDays(to, 1) <= today ? addDays(to, 1).slice(0, 7) : null),
    habits,
  };
}

export async function loadHabitHistory(env: DashboardEnv, query: HabitHistoryQuery, now = new Date()) {
  const info = connection(env);
  const { from, to } = habitHistoryRange(query);
  // 毎週のHabitは期間の前後にはみ出す週の記録も要るので、最初の週の月曜から読む
  const logFrom = mondayOf(from);
  const logTo = addDays(mondayOf(to), 6);
  const [habits, logs] = await Promise.all([
    fetchRows(info, "habits", HABIT_SELECT, (endpoint) => endpoint.searchParams.set("order", "created_at.asc,id.asc")),
    fetchRows(info, "habit_logs", LOG_SELECT, (endpoint) => {
      endpoint.searchParams.set("practiced_on", `gte.${logFrom}`);
      endpoint.searchParams.append("practiced_on", `lte.${logTo}`);
      endpoint.searchParams.set("order", "practiced_on.asc,id.asc");
    }),
  ]);
  return normalizeHabitHistory(habits as HabitRow[], logs as HabitLogRow[], query, now);
}

export function validateHabitMutationRequest(request: Request, action: "habit-create" | "habit-update" | "habit-log") {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== origin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== action) return { status: 403, error: "操作用ヘッダーがありません。" };
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const length = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_CHARS) return { status: 413, error: "リクエストが大きすぎます。" };
  return null;
}

async function readJson(request: Request): Promise<ValidationResult<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  try {
    const value: unknown = JSON.parse(raw);
    return isPlainObject(value)
      ? { ok: true, value }
      : { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
}

function validateHabitFields(value: Record<string, unknown>): ValidationResult<HabitCreateInput> {
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.trim().length > 240) {
    return { ok: false, status: 400, error: "習慣名は240文字以内で入力してください。" };
  }
  if (value.purpose !== null && typeof value.purpose !== "string") {
    return { ok: false, status: 400, error: "目的の形式が正しくありません。" };
  }
  const purpose = typeof value.purpose === "string" ? value.purpose.trim() || null : null;
  if (purpose !== null && purpose.length > 2000) {
    return { ok: false, status: 400, error: "目的は2000文字以内で入力してください。" };
  }
  if (typeof value.cadence !== "string" || !CADENCES.has(value.cadence)) {
    return { ok: false, status: 400, error: "頻度が正しくありません。" };
  }
  return { ok: true, value: { name: value.name.trim(), purpose, cadence: value.cadence as HabitCadence } };
}

export async function readHabitCreateInput(request: Request): Promise<ValidationResult<HabitCreateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasOnlyKeys(parsed.value, ["name", "purpose", "cadence"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  return validateHabitFields(parsed.value);
}

export async function readHabitUpdateInput(request: Request): Promise<ValidationResult<HabitUpdateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasOnlyKeys(parsed.value, ["id", "name", "purpose", "cadence", "status", "original"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const fields = validateHabitFields(parsed.value);
  if (!fields.ok) return fields;
  const original = parsed.value.original;
  const originalUpdatedAt = isPlainObject(original) ? isoDate(original.updatedAt) : null;
  if (!Number.isSafeInteger(parsed.value.id) || Number(parsed.value.id) <= 0
    || typeof parsed.value.status !== "string" || !STATUSES.has(parsed.value.status)
    || !isPlainObject(original) || !hasOnlyKeys(original, ["updatedAt"])
    || !originalUpdatedAt) {
    return { ok: false, status: 400, error: "編集内容の形式が正しくありません。" };
  }
  return {
    ok: true,
    value: {
      id: Number(parsed.value.id),
      ...fields.value,
      status: parsed.value.status as HabitStatus,
      original: { updatedAt: originalUpdatedAt },
    },
  };
}

export async function readHabitLogInput(request: Request): Promise<ValidationResult<HabitLogInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const keys = "note" in parsed.value ? ["habitId", "practicedOn", "completed", "note"] : ["habitId", "practicedOn", "completed"];
  if (!hasOnlyKeys(parsed.value, keys)
    || !Number.isSafeInteger(parsed.value.habitId) || Number(parsed.value.habitId) <= 0
    || plainDate(parsed.value.practicedOn) === null || typeof parsed.value.completed !== "boolean") {
    return { ok: false, status: 400, error: "記録内容の形式が正しくありません。" };
  }
  const rawNote = parsed.value.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    return { ok: false, status: 400, error: "メモの形式が正しくありません。" };
  }
  const note = typeof rawNote === "string" ? rawNote.trim() || null : rawNote;
  if (note && note.length > MAX_NOTE_CHARS) {
    return { ok: false, status: 400, error: `メモは${MAX_NOTE_CHARS}文字以内で入力してください。` };
  }
  if (note && parsed.value.completed === false) {
    return { ok: false, status: 400, error: "メモは実施した記録にだけ残せます。" };
  }
  return {
    ok: true,
    value: {
      habitId: Number(parsed.value.habitId),
      practicedOn: String(parsed.value.practicedOn),
      completed: parsed.value.completed,
      ...(note !== undefined ? { note } : {}),
    },
  };
}

async function mutationResponse(response: Response, table: string): Promise<unknown[]> {
  if (!response.ok) throw responseError(response, table);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
  return rows;
}

export async function createHabit(env: DashboardEnv, input: HabitCreateInput, now = new Date()) {
  const info = connection(env);
  const endpoint = new URL("/rest/v1/habits", info.url);
  endpoint.searchParams.set("select", HABIT_SELECT);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: headers(info, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({
        source_route_id: null,
        source_want_id: null,
        name: input.name,
        purpose: input.purpose,
        cadence: input.cadence,
        status: "active",
        started_on: todayInTokyo(now),
        updated_at: now.toISOString(),
      }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habits.");
  }
  const rows = await mutationResponse(response, "habits");
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habits created an unexpected number of rows.");
  return rows[0];
}

export async function updateHabit(env: DashboardEnv, input: HabitUpdateInput, now = new Date()) {
  const info = connection(env);
  const endpoint = new URL("/rest/v1/habits", info.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("updated_at", `eq.${input.original.updatedAt}`);
  endpoint.searchParams.set("select", HABIT_SELECT);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(info, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({
        name: input.name,
        purpose: input.purpose,
        cadence: input.cadence,
        status: input.status,
        updated_at: now.toISOString(),
      }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habits.");
  }
  const rows = await mutationResponse(response, "habits");
  if (rows.length === 0) throw new DashboardError("HABIT_UPDATE_CONFLICT", "Habit changed before this update.", 409);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habits updated an unexpected number of rows.");
  return rows[0];
}

async function findHabit(info: Connection, id: number): Promise<HabitRow | null> {
  const rows = await fetchRows(info, "habits", HABIT_SELECT, (endpoint) => {
    endpoint.searchParams.set("id", `eq.${id}`);
    endpoint.searchParams.set("limit", "1");
  });
  if (rows.length > 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habits returned duplicate ids.");
  return rows[0] as HabitRow | undefined || null;
}

async function findPeriodLog(
  info: Connection,
  habitId: number,
  cadence: HabitCadence,
  practicedOn: string,
): Promise<HabitLogRow | null> {
  const rows = await fetchRows(info, "habit_logs", LOG_SELECT, (endpoint) => {
    endpoint.searchParams.set("habit_id", `eq.${habitId}`);
    if (cadence === "weekly") {
      // 過去の日付で記録するときも、同じ週の後の日の記録を見落とさないよう週全体を見る
      endpoint.searchParams.set("practiced_on", `gte.${mondayOf(practicedOn)}`);
      endpoint.searchParams.append("practiced_on", `lte.${addDays(mondayOf(practicedOn), 6)}`);
    } else {
      endpoint.searchParams.set("practiced_on", `eq.${practicedOn}`);
    }
    endpoint.searchParams.set("order", "practiced_on.asc,id.asc");
    endpoint.searchParams.set("limit", "1");
  });
  return rows[0] as HabitLogRow | undefined || null;
}

async function updateLogNote(info: Connection, log: HabitLogRow, note: string | null): Promise<Record<string, unknown>> {
  const id = integer(log.id);
  if (id === null) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habit_logs returned an invalid id.");
  const endpoint = new URL("/rest/v1/habit_logs", info.url);
  endpoint.searchParams.set("id", `eq.${id}`);
  endpoint.searchParams.set("select", LOG_SELECT);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(info, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ note }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habit_logs.");
  }
  const rows = await mutationResponse(response, "habit_logs");
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habit_logs updated an unexpected number of rows.");
  return rows[0] as Record<string, unknown>;
}

export async function applyHabitLog(env: DashboardEnv, input: HabitLogInput, now = new Date()) {
  const today = todayInTokyo(now);
  const target = input.practicedOn;
  // 今日から BACKFILL_DAYS 日前までは、記録漏れを後から直せる（#155）
  if (target > today || target < addDays(today, -BACKFILL_DAYS)) {
    throw new DashboardError("HABIT_DATE_INVALID", "Only the last 7 days can be changed.", 400);
  }
  const info = connection(env);
  const habit = await findHabit(info, input.habitId);
  if (!habit) throw new DashboardError("HABIT_NOT_FOUND", "Habit was not found.", 404);
  if (text(habit.status) !== "active") throw new DashboardError("HABIT_NOT_ACTIVE", "Habit is not active.", 409);
  const cadence = text(habit.cadence) as HabitCadence;
  if (!CADENCES.has(cadence)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Habit cadence is invalid.");
  const startedOn = plainDate(habit.started_on) || today;
  if (target < startedOn || (!isEligible(cadence, target, startedOn) && cadence !== "weekly")) {
    throw new DashboardError("HABIT_NOT_DUE", "Habit is not due on that date.", 409);
  }
  const periodDate = cadence === "weekly" ? mondayOf(target) : target;
  const trackingKey = `${cadence === "weekly" ? "W" : "D"}:${periodDate}`;

  if (!input.completed) {
    const endpoint = new URL("/rest/v1/habit_logs", info.url);
    endpoint.searchParams.set("habit_id", `eq.${input.habitId}`);
    endpoint.searchParams.set("practiced_on", `eq.${target}`);
    endpoint.searchParams.set("select", LOG_SELECT);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "DELETE",
        headers: headers(info, { Prefer: "return=representation" }),
      });
    } catch {
      throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habit_logs.");
    }
    const rows = await mutationResponse(response, "habit_logs");
    if (rows.length > 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habit_logs deleted an unexpected number of rows.");
    return { habitId: input.habitId, practicedOn: target, completed: false };
  }

  const existing = await findPeriodLog(info, input.habitId, cadence, target);
  if (existing) {
    const practicedOn = plainDate(existing.practiced_on);
    if (practicedOn !== target) throw new DashboardError("HABIT_WEEK_ALREADY_COMPLETED", "Weekly habit was already completed.", 409);
    // 記録済みの日は、メモだけを書き換える（#156）
    if (input.note === undefined || (text(existing.note) || null) === input.note) return { ...existing, completed: true };
    return { ...await updateLogNote(info, existing, input.note), completed: true };
  }

  const endpoint = new URL("/rest/v1/habit_logs", info.url);
  endpoint.searchParams.set("select", LOG_SELECT);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: headers(info, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ habit_id: input.habitId, practiced_on: target, note: input.note ?? null, tracking_key: trackingKey }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habit_logs.");
  }
  if (response.status === 409) {
    const raced = await findPeriodLog(info, input.habitId, cadence, target);
    if (raced && plainDate(raced.practiced_on) === target) return { ...raced, completed: true };
    throw new DashboardError("HABIT_WEEK_ALREADY_COMPLETED", "Weekly habit was already completed.", 409);
  }
  const rows = await mutationResponse(response, "habit_logs");
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "habit_logs created an unexpected number of rows.");
  return { ...rows[0] as Record<string, unknown>, completed: true };
}
