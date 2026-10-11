import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { todayInTokyo } from "./habits.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

// SF6ページ（コンボ帳・注意点・練習メニュー・対戦振り返り）。4種類の記録を同じ形のAPIで扱うため、
// 項目の定義（FieldSpec）から入力検証・列名の変換・SELECTを組み立てる。

type FieldSpec =
  | { key: string; column: string; type: "text"; max: number; required?: boolean }
  | { key: string; column: string; type: "int"; min: number; max: number; nullable?: boolean }
  | { key: string; column: string; type: "enum"; values: readonly string[] }
  | { key: string; column: string; type: "bool" }
  | { key: string; column: string; type: "date" }
  | { key: string; column: string; type: "ref" };

interface ResourceSpec {
  table: string;
  fields: FieldSpec[];
  /** updated_at を持つ表だけ編集できる（楽観ロック）。練習記録は追加と削除だけ。 */
  editable: boolean;
  order: string;
  /** 項目をまたぐ条件。違反ならエラーメッセージを返す。 */
  check?: (value: Record<string, unknown>) => string | null;
}

export const SF6_POSITIONS = ["anywhere", "midscreen", "corner"] as const;
export const SF6_NOTE_CATEGORIES = ["matchup", "self", "general"] as const;
export const SF6_DRILL_STATUSES = ["active", "done"] as const;
export const SF6_RESULTS = ["win", "lose", "draw"] as const;
export const SF6_MODES = ["ranked", "casual", "battle_hub", "tournament", "other"] as const;

const NAME_MAX = 40;
const LONG_MAX = 2000;

export const SF6_RESOURCES = {
  combos: {
    table: "sf6_combos",
    editable: true,
    order: "character.asc,created_at.asc",
    fields: [
      { key: "character", column: "character", type: "text", max: NAME_MAX, required: true },
      { key: "title", column: "title", type: "text", max: 120, required: true },
      { key: "notation", column: "notation", type: "text", max: 1000, required: true },
      { key: "position", column: "position", type: "enum", values: SF6_POSITIONS },
      { key: "damage", column: "damage", type: "int", min: 0, max: 20000, nullable: true },
      { key: "driveCost", column: "drive_cost", type: "int", min: 0, max: 6 },
      { key: "saCost", column: "sa_cost", type: "int", min: 0, max: 3 },
      { key: "mastery", column: "mastery", type: "int", min: 0, max: 3 },
      { key: "memo", column: "memo", type: "text", max: LONG_MAX },
      { key: "archived", column: "archived", type: "bool" },
    ],
  },
  notes: {
    table: "sf6_notes",
    editable: true,
    order: "created_at.desc",
    fields: [
      { key: "category", column: "category", type: "enum", values: SF6_NOTE_CATEGORIES },
      { key: "opponent", column: "opponent", type: "text", max: NAME_MAX },
      { key: "body", column: "body", type: "text", max: LONG_MAX, required: true },
      { key: "pinned", column: "pinned", type: "bool" },
      { key: "resolved", column: "resolved", type: "bool" },
    ],
    check: (value) => (value.category === "matchup") === (value.opponent !== null)
      ? null
      : value.category === "matchup" ? "対キャラの注意点には相手キャラを入力してください。" : "相手キャラは対キャラの注意点にだけ入力できます。",
  },
  drills: {
    table: "sf6_drills",
    editable: true,
    order: "created_at.asc",
    fields: [
      { key: "title", column: "title", type: "text", max: 200, required: true },
      { key: "detail", column: "detail", type: "text", max: LONG_MAX },
      { key: "comboId", column: "combo_id", type: "ref" },
      { key: "status", column: "status", type: "enum", values: SF6_DRILL_STATUSES },
    ],
  },
  logs: {
    table: "sf6_drill_logs",
    editable: false,
    order: "practiced_on.desc,id.desc",
    fields: [
      { key: "drillId", column: "drill_id", type: "ref" },
      { key: "practicedOn", column: "practiced_on", type: "date" },
      { key: "attempts", column: "attempts", type: "int", min: 1, max: 10000, nullable: true },
      { key: "successes", column: "successes", type: "int", min: 0, max: 10000, nullable: true },
      { key: "note", column: "note", type: "text", max: LONG_MAX },
    ],
    check: (value) => {
      if (value.drillId === null) return "練習メニューを選んでください。";
      if ((value.attempts === null) !== (value.successes === null)) return "回数と成功数は両方入力するか、両方空欄にしてください。";
      if (value.attempts !== null && Number(value.successes) > Number(value.attempts)) return "成功数は回数以下にしてください。";
      return null;
    },
  },
  matches: {
    table: "sf6_matches",
    editable: true,
    order: "played_on.desc,id.desc",
    fields: [
      { key: "playedOn", column: "played_on", type: "date" },
      { key: "myCharacter", column: "my_character", type: "text", max: NAME_MAX, required: true },
      { key: "opponent", column: "opponent", type: "text", max: NAME_MAX, required: true },
      { key: "result", column: "result", type: "enum", values: SF6_RESULTS },
      { key: "mode", column: "mode", type: "enum", values: SF6_MODES },
      { key: "good", column: "good", type: "text", max: LONG_MAX },
      { key: "bad", column: "bad", type: "text", max: LONG_MAX },
    ],
  },
} satisfies Record<string, ResourceSpec>;

export type Sf6Resource = keyof typeof SF6_RESOURCES;

export function isSf6Resource(value: unknown): value is Sf6Resource {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SF6_RESOURCES, value);
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const MAX_REQUEST_CHARS = 16_000;
const PAGE_SIZE = 1000;
const INVALID = "入力内容の形式が正しくありません。";

function spec(resource: Sf6Resource): ResourceSpec {
  return SF6_RESOURCES[resource];
}

function selectOf(resource: Sf6Resource): string {
  const { fields, editable } = spec(resource);
  return ["id", ...fields.map((field) => field.column), "created_at", ...(editable ? ["updated_at"] : [])].join(",");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** 1項目を検証して、DBへ書く値（未入力の任意項目は null）を返す。 */
function readField(field: FieldSpec, raw: unknown): { ok: true; value: unknown } | { ok: false } {
  switch (field.type) {
    case "text": {
      if (raw === null || raw === undefined) return field.required ? { ok: false } : { ok: true, value: null };
      if (typeof raw !== "string") return { ok: false };
      const value = raw.trim();
      if (!value) return field.required ? { ok: false } : { ok: true, value: null };
      return [...value].length <= field.max ? { ok: true, value } : { ok: false };
    }
    case "int":
      if (raw === null && field.nullable) return { ok: true, value: null };
      return Number.isSafeInteger(raw) && Number(raw) >= field.min && Number(raw) <= field.max
        ? { ok: true, value: raw }
        : { ok: false };
    case "enum":
      return typeof raw === "string" && field.values.includes(raw) ? { ok: true, value: raw } : { ok: false };
    case "bool":
      return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false };
    case "date":
      return isPlainDate(raw) ? { ok: true, value: raw } : { ok: false };
    case "ref":
      if (raw === null) return { ok: true, value: null };
      return isId(raw) ? { ok: true, value: raw } : { ok: false };
  }
}

const FIELD_LABELS: Record<string, string> = {
  character: "キャラ", title: "名前", notation: "レシピ", damage: "ダメージ", body: "内容",
  opponent: "相手キャラ", myCharacter: "使用キャラ", playedOn: "日付", practicedOn: "日付",
  attempts: "回数", successes: "成功数", memo: "メモ", detail: "詳細", note: "メモ", good: "良かった点", bad: "反省点",
};

/** 全項目をそろえて送る前提で、知らないキーや欠けたキーは拒否する。 */
export function validateSf6Fields(resource: Sf6Resource, body: Record<string, unknown>): ValidationResult<Record<string, unknown>> {
  const { fields, check } = spec(resource);
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.key in body)) return { ok: false, status: 400, error: INVALID };
    const parsed = readField(field, body[field.key]);
    if (!parsed.ok) {
      const label = FIELD_LABELS[field.key];
      return { ok: false, status: 400, error: label ? `「${label}」の入力内容を確認してください。` : INVALID };
    }
    value[field.key] = parsed.value;
  }
  const problem = check?.(value);
  if (problem) return { ok: false, status: 400, error: problem };
  return { ok: true, value };
}

export interface Sf6CreateInput { fields: Record<string, unknown> }
export interface Sf6UpdateInput { id: number; updatedAt: string; fields: Record<string, unknown> }
export interface Sf6DeleteInput { id: number }

export function validateSf6MutationRequest(request: Request) {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== origin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "sf6") return { status: 403, error: "操作用ヘッダーがありません。" };
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
    return isPlainObject(value) ? { ok: true, value } : { ok: false, status: 400, error: INVALID };
  } catch {
    return { ok: false, status: 400, error: INVALID };
  }
}

function onlyKeys(body: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

export async function readSf6CreateInput(request: Request, resource: Sf6Resource): Promise<ValidationResult<Sf6CreateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!onlyKeys(parsed.value, spec(resource).fields.map((field) => field.key))) return { ok: false, status: 400, error: INVALID };
  const fields = validateSf6Fields(resource, parsed.value);
  return fields.ok ? { ok: true, value: { fields: fields.value } } : fields;
}

export async function readSf6UpdateInput(request: Request, resource: Sf6Resource): Promise<ValidationResult<Sf6UpdateInput>> {
  if (!spec(resource).editable) return { ok: false, status: 405, error: "この記録は編集できません。削除して登録し直してください。" };
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const { id, updatedAt, ...rest } = parsed.value;
  if (!isId(id) || !isTimestamp(updatedAt)
    || !onlyKeys(rest, spec(resource).fields.map((field) => field.key))) {
    return { ok: false, status: 400, error: INVALID };
  }
  const fields = validateSf6Fields(resource, rest);
  return fields.ok ? { ok: true, value: { id, updatedAt, fields: fields.value } } : fields;
}

export async function readSf6DeleteInput(request: Request): Promise<ValidationResult<Sf6DeleteInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const { id } = parsed.value;
  if (!onlyKeys(parsed.value, ["id"]) || !isId(id)) return { ok: false, status: 400, error: INVALID };
  return { ok: true, value: { id } };
}

// ---------- Supabase ----------

interface Connection {
  url: URL;
  key: string;
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

function responseError(response: Response, table: string): DashboardError {
  const code = response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${table} returned ${response.status}.`);
}

async function request(info: Connection, table: string, endpoint: URL, init: RequestInit = {}): Promise<unknown[]> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      headers: supabaseHeaders(info.key, {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.method ? { Prefer: "return=representation" } : {}),
      }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", `Could not reach ${table}.`);
  }
  if (!response.ok) {
    // 参照先（練習メニューやコンボ）が消えていると外部キー違反（409）になる
    if (response.status === 409) throw new DashboardError("SF6_REFERENCE_MISSING", `${table} reference is missing.`, 409);
    throw responseError(response, table);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
  return rows;
}

async function fetchAll(info: Connection, resource: Sf6Resource): Promise<unknown[]> {
  const { table, order } = spec(resource);
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, info.url);
    endpoint.searchParams.set("select", selectOf(resource));
    endpoint.searchParams.set("order", order);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const page = await request(info, table, endpoint);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** DBの行をAPIの形（camelCase）にする。壊れた行は捨てる。 */
export function toSf6Item(resource: Sf6Resource, row: unknown): Record<string, unknown> | null {
  if (!isPlainObject(row) || !isId(row.id)) return null;
  const item: Record<string, unknown> = { id: row.id };
  for (const field of spec(resource).fields) {
    const raw = row[field.column];
    if (field.type === "text") item[field.key] = typeof raw === "string" && raw ? raw : null;
    else if (field.type === "int" || field.type === "ref") item[field.key] = Number.isSafeInteger(raw) ? raw : null;
    else if (field.type === "bool") item[field.key] = raw === true;
    else item[field.key] = typeof raw === "string" ? raw : null;
  }
  item.createdAt = typeof row.created_at === "string" ? row.created_at : null;
  if (spec(resource).editable) item.updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  return item;
}

function columnsOf(resource: Sf6Resource, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(spec(resource).fields.map((field) => [field.column, fields[field.key]]));
}

export async function loadSf6(env: DashboardEnv, now = new Date()) {
  const info = connection(env);
  const resources = Object.keys(SF6_RESOURCES) as Sf6Resource[];
  const results = await Promise.all(resources.map((resource) => fetchAll(info, resource)));
  const data = Object.fromEntries(resources.map((resource, index) => [
    resource,
    results[index].map((row) => toSf6Item(resource, row)).filter((item) => item !== null),
  ]));
  return { today: todayInTokyo(now), source: { state: "live" }, ...data };
}

export async function createSf6Item(env: DashboardEnv, resource: Sf6Resource, input: Sf6CreateInput) {
  const info = connection(env);
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("select", selectOf(resource));
  const rows = await request(info, table, endpoint, { method: "POST", body: JSON.stringify(columnsOf(resource, input.fields)) });
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} created an unexpected number of rows.`);
  return toSf6Item(resource, rows[0]);
}

export async function updateSf6Item(env: DashboardEnv, resource: Sf6Resource, input: Sf6UpdateInput, now = new Date()) {
  const info = connection(env);
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("updated_at", `eq.${input.updatedAt}`);
  endpoint.searchParams.set("select", selectOf(resource));
  const rows = await request(info, table, endpoint, {
    method: "PATCH",
    body: JSON.stringify({ ...columnsOf(resource, input.fields), updated_at: now.toISOString() }),
  });
  if (rows.length === 0) throw new DashboardError("SF6_UPDATE_CONFLICT", `${table} changed before this update.`, 409);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} updated an unexpected number of rows.`);
  return toSf6Item(resource, rows[0]);
}

export async function deleteSf6Item(env: DashboardEnv, resource: Sf6Resource, input: Sf6DeleteInput) {
  const info = connection(env);
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("select", "id");
  const rows = await request(info, table, endpoint, { method: "DELETE" });
  if (rows.length === 0) throw new DashboardError("SF6_NOT_FOUND", `${table} row was not found.`, 404);
  return { id: input.id };
}
