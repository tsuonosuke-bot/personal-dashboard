import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { todayInTokyo } from "./habits.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

// SF6ページ（コンボ・起き攻め・フレーム・練習メニュー・対戦振り返り）。どの記録も同じ形のAPIで扱うため、
// 項目の定義（FieldSpec）から入力検証・列名の変換・SELECTを組み立てる。
// 手順（コンボと起き攻め）だけは始動の状況と結果を子表に持つので、保存と削除をRPC（sf6_save_sequence /
// sf6_delete_sequence）で1トランザクションにする。親の項目の検証はほかと同じ FieldSpec で行う。

/**
 * optional: 送られてこなければ変えない項目（追加時はDBの既定値）。項目を増やしたあとも、
 * 読み込み済みの古い画面からの保存が失敗しないようにするため。"update" は編集のときだけ省略でき、追加では必須。
 * readOnly: 読むだけの項目（入力で送られてきたら400）。
 */
type FieldSpec = { key: string; column: string; optional?: true | "update"; readOnly?: true } & (
  | { type: "text"; max: number; required?: boolean; preserveWhitespace?: true }
  | { type: "int"; min: number; max: number; nullable?: boolean }
  | { type: "half"; min: number; max: number }
  | { type: "enum"; values: readonly string[]; nullable?: boolean }
  | { type: "bool" }
  | { type: "date" }
  | { type: "ref" }
  | { type: "refs"; maxItems: number }
  /** 始動の状況：状況の id か {state: {advantage, position, recovery, name?}}（局面を探して、なければ作る）。column は埋め込みの名前 */
  | { type: "situationRefs"; maxItems: number }
  /** 結果 → 次の状況：[{kind, opponentAction, outcome, next}]。column は埋め込みの名前 */
  | { type: "results"; maxItems: number }
);

interface ResourceSpec {
  table: string;
  fields: FieldSpec[];
  /** updated_at を持つ表だけ編集できる（楽観ロック）。練習記録は追加と削除だけ。 */
  editable: boolean;
  order: string;
  /** 項目をまたぐ条件。違反ならエラーメッセージを返す。 */
  check?: (value: Record<string, unknown>) => string | null;
  /** GETで読むだけ（技データの版）。書き込みは404。 */
  readOnly?: true;
  /** id 列のない表（主キーがキャラ名など）。 */
  noId?: true;
  /** PostgREST の埋め込み。select に足す。 */
  embed?: string;
  /** 保存・削除をRPCで行う（手順）。 */
  write?: "rpc";
}

export const SF6_POSITIONS = ["anywhere", "midscreen", "corner"] as const;
export const SF6_DRILL_STATUSES = ["active", "done"] as const;
export const SF6_RESULTS = ["win", "lose", "draw"] as const;
export const SF6_MODES = ["ranked", "casual", "battle_hub", "tournament", "other"] as const;
export const SF6_RECOVERIES = ["back_roll", "no_back_roll", "none"] as const;
export const SF6_LAYERINGS = ["meaty", "safe_jump", "other"] as const;
export const SF6_SITUATION_KINDS = ["trigger", "state"] as const;
export const SF6_RESULT_KINDS = ["hit", "counter_hit", "punish_counter", "hit_other", "guard", "opponent"] as const;
/** 起き攻めに対して相手が取れる行動。結果の outcome は win（こちらが勝つ）/ lose / unknown。 */
/** 相手の行動の結果がどのヒットか。other だけ個別の次の状況を持つ。 */
export const SF6_HIT_TYPES = ["hit", "counter_hit", "punish_counter", "other"] as const;
export const SF6_OPPONENT_OPTIONS = ["reversal", "backdash", "jump", "tech", "delay_tech", "mash", "drive_impact", "parry", "drive_reversal", "back_roll"] as const;
export const SF6_OUTCOMES = ["win", "lose", "unknown"] as const;
export const SF6_GUARD_SETTINGS = ["none", "all", "random"] as const;
export const SF6_COUNTER_SETTINGS = ["normal", "counter", "punish_counter", "random"] as const;
export const SF6_RECOVERY_SETTINGS = ["neutral", "back", "random"] as const;

/** 廃止したリソース・項目。古い画面を開いたままの保存には、再読み込みを促す。 */
export const SF6_STALE_MESSAGE = "画面が古くなっています。ページを再読み込みしてください。";
const LEGACY_RESOURCES = ["combos", "setplays", "notes"];
const LEGACY_KEYS: Record<string, string[]> = { drills: ["comboId", "setplayId"] };

const NAME_MAX = 40;
const LONG_MAX = 2000;

export const SF6_RESOURCES = {
  situations: {
    table: "sf6_situations",
    editable: true,
    order: "kind.asc,id.asc",
    fields: [
      { key: "character", column: "character", type: "text", max: NAME_MAX },
      { key: "kind", column: "kind", type: "enum", values: SF6_SITUATION_KINDS },
      { key: "name", column: "name", type: "text", max: 60, required: true },
      { key: "presetKey", column: "preset_key", type: "text", max: 30, readOnly: true },
      { key: "advantage", column: "advantage", type: "int", min: -99, max: 300, nullable: true },
      { key: "position", column: "position", type: "enum", values: SF6_POSITIONS },
      { key: "recovery", column: "recovery", type: "enum", values: SF6_RECOVERIES, nullable: true },
      { key: "throwRange", column: "throw_range", type: "bool", optional: true },
      { key: "memo", column: "memo", type: "text", max: LONG_MAX, preserveWhitespace: true },
      { key: "archived", column: "archived", type: "bool" },
    ],
    check: (value) => {
      if (value.kind === "trigger" && (value.advantage !== null || value.recovery !== null || value.position !== "anywhere" || value.throwRange === true)) {
        return "きっかけには有利F・位置・ダウン・投げ間合いを入れられません。";
      }
      if (value.kind === "state" && (value.advantage === null || value.character === null)) return "局面にはキャラと有利Fを入れてください。";
      return null;
    },
  },
  sequences: {
    table: "sf6_sequences",
    editable: true,
    write: "rpc",
    order: "character.asc,created_at.asc",
    embed: "starts:sf6_sequence_starts(situation_id),results:sf6_sequence_results(kind,opponent_action,outcome,hit_type,next_situation_id)",
    fields: [
      { key: "character", column: "character", type: "text", max: NAME_MAX, required: true },
      { key: "title", column: "title", type: "text", max: 120, required: true },
      { key: "notation", column: "notation", type: "text", max: 1000, required: true },
      { key: "startup", column: "startup", type: "int", min: 1, max: 99, nullable: true },
      { key: "driveCost", column: "drive_cost", type: "half", min: 0, max: 6 },
      { key: "saCost", column: "sa_cost", type: "int", min: 0, max: 4 },
      { key: "position", column: "position", type: "enum", values: SF6_POSITIONS },
      { key: "layering", column: "layering", type: "enum", values: SF6_LAYERINGS, nullable: true },
      { key: "mastery", column: "mastery", type: "int", min: 0, max: 3 },
      { key: "memo", column: "memo", type: "text", max: LONG_MAX, preserveWhitespace: true },
      { key: "archived", column: "archived", type: "bool" },
      { key: "starts", column: "starts", type: "situationRefs", maxItems: 12, optional: "update" },
      { key: "results", column: "results", type: "results", maxItems: 40, optional: "update" },
    ],
    check: (value) => {
      return value.results === undefined ? null : resultsProblem(value.results as Sf6ResultInput[]);
    },
  },
  drills: {
    table: "sf6_drills",
    editable: true,
    order: "created_at.asc",
    fields: [
      { key: "title", column: "title", type: "text", max: 200, required: true },
      { key: "detail", column: "detail", type: "text", max: LONG_MAX, preserveWhitespace: true },
      { key: "sequenceIds", column: "sequence_ids", type: "refs", maxItems: 8 },
      { key: "status", column: "status", type: "enum", values: SF6_DRILL_STATUSES },
      { key: "guardSetting", column: "guard_setting", type: "enum", values: SF6_GUARD_SETTINGS, nullable: true, optional: true },
      { key: "counterSetting", column: "counter_setting", type: "enum", values: SF6_COUNTER_SETTINGS, nullable: true, optional: true },
      { key: "recoverySetting", column: "recovery_setting", type: "enum", values: SF6_RECOVERY_SETTINGS, nullable: true, optional: true },
      { key: "reversalRecorded", column: "reversal_recorded", type: "bool", optional: true },
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
      { key: "bestStreak", column: "best_streak", type: "int", min: 0, max: 10000, nullable: true, optional: true },
    ],
    check: (value) => {
      if (value.drillId === null) return "練習メニューを選んでください。";
      if ((value.attempts === null) !== (value.successes === null)) return "回数と成功数は両方入力するか、両方空欄にしてください。";
      if (value.attempts !== null && Number(value.successes) > Number(value.attempts)) return "成功数は回数以下にしてください。";
      if (value.bestStreak != null && (value.successes === null || Number(value.bestStreak) > Number(value.successes))) {
        return "連続成功は成功数以下にしてください（回数・成功数も入力してください）。";
      }
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
  moveSets: {
    table: "sf6_move_sets",
    editable: false,
    readOnly: true,
    noId: true,
    order: "character.asc",
    fields: [
      { key: "character", column: "character", type: "text", max: NAME_MAX, required: true },
      { key: "dataVersion", column: "data_version", type: "text", max: 40, required: true },
      { key: "sourceUrl", column: "source_url", type: "text", max: 300, required: true },
      { key: "checkedOn", column: "checked_on", type: "date" },
      { key: "moveCount", column: "move_count", type: "int", min: 0, max: 500 },
    ],
  },
} satisfies Record<string, ResourceSpec>;

export type Sf6Resource = keyof typeof SF6_RESOURCES;

export function isSf6Resource(value: unknown): value is Sf6Resource {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SF6_RESOURCES, value);
}

/** 廃止したリソース（combos / setplays / notes）。404と再読み込みの文言を返す。 */
export function isLegacySf6Resource(value: unknown): boolean {
  return typeof value === "string" && LEGACY_RESOURCES.includes(value);
}

export function isReadOnlySf6Resource(resource: Sf6Resource): boolean {
  return spec(resource).readOnly === true;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

/** 次の状況の指定：状況の id か、局面の数値（DBが探して、なければ作る）。 */
type SituationRef = number | { state: { advantage: number; position: string; recovery: string | null; name: string | null } };
interface Sf6ResultInput { kind: string; opponentAction: string | null; outcome: string | null; hitType: string | null; next: SituationRef | null }

const MAX_REQUEST_CHARS = 16_000;
const PAGE_SIZE = 1000;
const INVALID = "入力内容の形式が正しくありません。";
const CHILD_TYPES = new Set(["situationRefs", "results"]);

function spec(resource: Sf6Resource): ResourceSpec {
  return SF6_RESOURCES[resource];
}

/** 列として読み書きする項目（子表の項目を除く）。 */
function columnFields(resource: Sf6Resource): FieldSpec[] {
  return spec(resource).fields.filter((field) => !CHILD_TYPES.has(field.type));
}

/** 入力で受け付ける項目のキー（読み取り専用を除く）。 */
function writableKeys(resource: Sf6Resource): string[] {
  return spec(resource).fields.filter((field) => !field.readOnly).map((field) => field.key);
}

function selectOf(resource: Sf6Resource): string {
  const { editable, noId, embed } = spec(resource);
  return [
    ...(noId ? [] : ["id"]),
    ...columnFields(resource).map((field) => field.column),
    "created_at",
    ...(editable ? ["updated_at"] : []),
    ...(embed ? [embed] : []),
  ].join(",");
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

function onlyKeys(body: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

function oneOf(values: readonly string[], raw: unknown): raw is string {
  return typeof raw === "string" && values.includes(raw);
}

function readSituationRef(raw: unknown): SituationRef | null {
  if (isId(raw)) return raw;
  if (!isPlainObject(raw) || !onlyKeys(raw, ["state"]) || !isPlainObject(raw.state)) return null;
  const { advantage, position = "anywhere", recovery = null, name = null } = raw.state;
  if (!onlyKeys(raw.state, ["advantage", "position", "recovery", "name"])) return null;
  if (!Number.isSafeInteger(advantage) || Number(advantage) < -99 || Number(advantage) > 300) return null;
  if (!oneOf(SF6_POSITIONS, position) || (recovery !== null && !oneOf(SF6_RECOVERIES, recovery))) return null;
  if (name !== null && typeof name !== "string") return null;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if ([...trimmed].length > 60) return null;
  return { state: { advantage: Number(advantage), position, recovery, name: trimmed || null } };
}

function readResult(raw: unknown): Sf6ResultInput | null {
  if (!isPlainObject(raw) || !onlyKeys(raw, ["kind", "opponentAction", "outcome", "hitType", "next", "nextSituationId"])) return null;
  const { kind, opponentAction = null, outcome = null, hitType = null } = raw;
  if (!oneOf(SF6_RESULT_KINDS, kind)) return null;
  if (opponentAction !== null && !oneOf(SF6_OPPONENT_OPTIONS, opponentAction)) return null;
  if (outcome !== null && !oneOf(SF6_OUTCOMES, outcome)) return null;
  if (hitType !== null && (kind !== "opponent" || !oneOf(SF6_HIT_TYPES, hitType))) return null;
  // GETの形（nextSituationId）もそのまま送り返せる
  const rawNext = "next" in raw ? raw.next : raw.nextSituationId;
  const next = rawNext === null || rawNext === undefined ? null : readSituationRef(rawNext);
  if (rawNext !== null && rawNext !== undefined && next === null) return null;
  return { kind, opponentAction, outcome, hitType, next };
}

/** 結果の組み合わせの問題。hit / counter_hit / punish_counter / hit_other / guard は次の状況が必須、相手の行動は○×–が必須、同じ結果は1つだけ。 */
function resultsProblem(results: Sf6ResultInput[]): string | null {
  const seen = new Set<string>();
  for (const result of results) {
    // 同じ結果（ヒットなど）に、次の状況を複数持てる（画面中央版・画面端版など）。同じ結果で同じ次の状況は重複
    const key = `${result.kind}:${result.opponentAction ?? ""}:${JSON.stringify(result.next)}`;
    if (seen.has(key)) return "同じ結果に同じ次の状況が2つあります。";
    seen.add(key);
    if (result.kind === "opponent") {
      if (result.opponentAction === null || result.outcome === null) return "相手の行動ごとの結果を選んでください。";
    } else if (result.opponentAction !== null || result.outcome !== null) {
      return INVALID;
    } else if (result.next === null) {
      return "ヒット・ガードの結果には次の状況を選んでください。";
    }
  }
  return null;
}

/** 1項目を検証して、DBへ書く値（未入力の任意項目は null）を返す。 */
function readField(field: FieldSpec, raw: unknown): { ok: true; value: unknown } | { ok: false } {
  switch (field.type) {
    case "text": {
      if (raw === null || raw === undefined) return field.required ? { ok: false } : { ok: true, value: null };
      if (typeof raw !== "string") return { ok: false };
      const value = field.preserveWhitespace ? raw : raw.trim();
      if (!raw.trim()) return field.required ? { ok: false } : { ok: true, value: null };
      return [...value].length <= field.max ? { ok: true, value } : { ok: false };
    }
    case "int":
      if (raw === null && field.nullable) return { ok: true, value: null };
      return Number.isSafeInteger(raw) && Number(raw) >= field.min && Number(raw) <= field.max
        ? { ok: true, value: raw }
        : { ok: false };
    case "half":
      return typeof raw === "number" && Number.isInteger(raw * 2) && raw >= field.min && raw <= field.max
        ? { ok: true, value: raw }
        : { ok: false };
    case "enum":
      if (raw === null && field.nullable) return { ok: true, value: null };
      return typeof raw === "string" && field.values.includes(raw) ? { ok: true, value: raw } : { ok: false };
    case "refs":
      return Array.isArray(raw) && raw.length <= field.maxItems && raw.every(isId) && new Set(raw).size === raw.length
        ? { ok: true, value: raw }
        : { ok: false };
    case "situationRefs": {
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > field.maxItems) return { ok: false };
      const refs = raw.map(readSituationRef);
      const ids = refs.filter((ref) => typeof ref === "number");
      if (refs.includes(null) || new Set(ids).size !== ids.length) return { ok: false };
      return { ok: true, value: refs };
    }
    case "results": {
      if (!Array.isArray(raw) || raw.length > field.maxItems) return { ok: false };
      const results = raw.map(readResult);
      if (results.includes(null)) return { ok: false };
      // 未確認で次の状況もない相手の行動は保存しない
      return {
        ok: true,
        value: (results as Sf6ResultInput[]).filter((result) => !(result.kind === "opponent" && result.outcome === "unknown" && result.next === null)),
      };
    }
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
  character: "キャラ", title: "名前", name: "名前", notation: "レシピ", startup: "発生F",
  opponent: "相手キャラ", myCharacter: "使用キャラ", playedOn: "日付", practicedOn: "日付", advantage: "有利F",
  attempts: "回数", successes: "成功数", memo: "メモ", detail: "詳細", note: "メモ", good: "良かった点", bad: "反省点",
  starts: "始動の状況", results: "結果", sequenceIds: "練習する手順", bestStreak: "連続成功", driveCost: "Dゲージ",
};

/**
 * 全項目をそろえて送る前提で、知らないキーや欠けたキーは拒否する。
 * mode "update" のときだけ、optional: "update" の項目を省略できる（省略した子表は変えない）。
 */
export function validateSf6Fields(
  resource: Sf6Resource,
  body: Record<string, unknown>,
  mode: "create" | "update" = "create",
): ValidationResult<Record<string, unknown>> {
  if (!onlyKeys(body, writableKeys(resource))) return { ok: false, status: 400, error: INVALID };
  const { fields, check } = spec(resource);
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    if (!(field.key in body)) {
      if (field.optional === true || (field.optional === "update" && mode === "update")) continue;
      const label = FIELD_LABELS[field.key];
      return { ok: false, status: 400, error: field.optional === "update" && label ? `「${label}」を入力してください。` : INVALID };
    }
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

function hasLegacyKeys(resource: Sf6Resource, body: Record<string, unknown>): boolean {
  return (LEGACY_KEYS[resource] || []).some((key) => key in body);
}

export async function readSf6CreateInput(request: Request, resource: Sf6Resource): Promise<ValidationResult<Sf6CreateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (hasLegacyKeys(resource, parsed.value)) return { ok: false, status: 400, error: SF6_STALE_MESSAGE };
  if (!onlyKeys(parsed.value, writableKeys(resource))) return { ok: false, status: 400, error: INVALID };
  const fields = validateSf6Fields(resource, parsed.value);
  return fields.ok ? { ok: true, value: { fields: fields.value } } : fields;
}

export async function readSf6UpdateInput(request: Request, resource: Sf6Resource): Promise<ValidationResult<Sf6UpdateInput>> {
  if (!spec(resource).editable) return { ok: false, status: 405, error: "この記録は編集できません。削除して登録し直してください。" };
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const { id, updatedAt, ...rest } = parsed.value;
  if (hasLegacyKeys(resource, rest)) return { ok: false, status: 400, error: SF6_STALE_MESSAGE };
  if (!isId(id) || !isTimestamp(updatedAt) || !onlyKeys(rest, writableKeys(resource))) {
    return { ok: false, status: 400, error: INVALID };
  }
  const fields = validateSf6Fields(resource, rest, "update");
  return fields.ok ? { ok: true, value: { id, updatedAt, fields: fields.value } } : fields;
}

export async function readSf6DeleteInput(request: Request): Promise<ValidationResult<Sf6DeleteInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const { id } = parsed.value;
  if (!onlyKeys(parsed.value, ["id"]) || !isId(id)) return { ok: false, status: 400, error: INVALID };
  return { ok: true, value: { id } };
}

/** GET /api/sf6/moves の character（1〜40字）。 */
export function readSf6MovesCharacter(url: URL): ValidationResult<string> {
  const character = url.searchParams.get("character")?.trim() || "";
  return character && [...character].length <= NAME_MAX
    ? { ok: true, value: character }
    : { ok: false, status: 400, error: "キャラを指定してください。" };
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

/** RPCの例外（raise exception の文字）とPostgreSQLのエラーコードを、画面に出すエラーへ対応づける。 */
const RPC_ERRORS: Array<[string, string, number]> = [
  ["SF6_CONFLICT", "SF6_UPDATE_CONFLICT", 409],
  ["SF6_SITUATION_MISSING", "SF6_REFERENCE_MISSING", 409],
  ["SF6_SITUATION_CHARACTER", "SF6_SITUATION_CHARACTER", 400],
  ["SF6_STARTS_REQUIRED", "SF6_STARTS_REQUIRED", 400],
  ["SF6_NOT_FOUND", "SF6_NOT_FOUND", 404],
  // 状況のトリガー：使用中の状況のキャラ・種類の変更、初期の状況の削除
  ["SF6_SITUATION_IN_USE", "SF6_SITUATION_IN_USE", 409],
  ["SF6_PRESET_SITUATION", "SF6_PRESET_SITUATION", 409],
];

async function responseError(response: Response, table: string): Promise<DashboardError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 本文が読めなくても、ステータスで分ける
  }
  const code = isPlainObject(body) && typeof body.code === "string" ? body.code : "";
  const message = isPlainObject(body) && typeof body.message === "string" ? body.message : "";
  const marker = RPC_ERRORS.find(([needle]) => message.includes(needle));
  if (marker) return new DashboardError(marker[1], `${table}: ${marker[0]}`, marker[2]);
  // 一意制約（状況の名前・局面の数値の重複）
  if (code === "23505") return new DashboardError("SF6_DUPLICATE", `${table} has a duplicate row.`, 409);
  // 参照先（状況・練習メニュー）が消えていると外部キー違反（409）になる
  if (code === "23503" || response.status === 409) return new DashboardError("SF6_REFERENCE_MISSING", `${table} reference is missing.`, 409);
  const failure = response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(failure, `${table} returned ${response.status}.`);
}

async function send(info: Connection, table: string, endpoint: URL, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchSupabase(endpoint, {
      ...init,
      headers: supabaseHeaders(info.key, {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.method && !endpoint.pathname.includes("/rpc/") ? { Prefer: "return=representation" } : {}),
      }),
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", `Could not reach ${table}.`);
  }
  if (!response.ok) throw await responseError(response, table);
  return response.json();
}

async function request(info: Connection, table: string, endpoint: URL, init: RequestInit = {}): Promise<unknown[]> {
  const rows = await send(info, table, endpoint, init);
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
  return rows;
}

async function rpc(info: Connection, name: string, args: Record<string, unknown>): Promise<number> {
  const id = await send(info, name, new URL(`/rest/v1/rpc/${name}`, info.url), { method: "POST", body: JSON.stringify(args) });
  if (!isId(id)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${name} returned invalid data.`);
  return id;
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

const RESULT_ORDER = [...SF6_RESULT_KINDS] as string[];
const OPPONENT_ORDER = [...SF6_OPPONENT_OPTIONS] as string[];

/** 埋め込みの結果をAPIの形にする。壊れた要素は捨て、hit → counter_hit → punish_counter → hit_other → guard → 相手の行動（定義順）に並べる。 */
function toResults(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => isPlainObject(row) && oneOf(SF6_RESULT_KINDS, row.kind)
      && (row.kind === "opponent" ? oneOf(SF6_OPPONENT_OPTIONS, row.opponent_action) && oneOf(SF6_OUTCOMES, row.outcome) : true))
    .map((row) => ({
      kind: row.kind,
      opponentAction: row.kind === "opponent" ? row.opponent_action : null,
      outcome: row.kind === "opponent" ? row.outcome : null,
      hitType: row.kind === "opponent" && oneOf(SF6_HIT_TYPES, row.hit_type) ? row.hit_type : null,
      nextSituationId: isId(row.next_situation_id) ? row.next_situation_id : null,
    }))
    .sort((a, b) => RESULT_ORDER.indexOf(String(a.kind)) - RESULT_ORDER.indexOf(String(b.kind))
      || OPPONENT_ORDER.indexOf(String(a.opponentAction)) - OPPONENT_ORDER.indexOf(String(b.opponentAction)));
}

/** DBの行をAPIの形（camelCase）にする。壊れた行は捨てる。 */
export function toSf6Item(resource: Sf6Resource, row: unknown): Record<string, unknown> | null {
  if (!isPlainObject(row) || (!spec(resource).noId && !isId(row.id))) return null;
  const item: Record<string, unknown> = spec(resource).noId ? {} : { id: row.id };
  for (const field of spec(resource).fields) {
    const raw = row[field.column];
    if (field.type === "text") item[field.key] = typeof raw === "string" && raw ? raw : null;
    else if (field.type === "int" || field.type === "ref") item[field.key] = Number.isSafeInteger(raw) ? raw : null;
    else if (field.type === "bool") item[field.key] = raw === true;
    // numeric列はPostgRESTの設定によって文字列で返ることがある
    else if (field.type === "half") item[field.key] = Number.isFinite(Number(raw)) && raw !== null ? Number(raw) : 0;
    else if (field.type === "refs") item[field.key] = Array.isArray(raw) ? raw.filter(isId) : [];
    else if (field.type === "situationRefs") {
      item[field.key] = Array.isArray(raw) ? raw.map((entry) => (isPlainObject(entry) ? entry.situation_id : null)).filter(isId) : [];
    } else if (field.type === "results") item[field.key] = toResults(raw);
    else item[field.key] = typeof raw === "string" ? raw : null;
  }
  item.createdAt = typeof row.created_at === "string" ? row.created_at : null;
  if (spec(resource).editable) item.updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  return item;
}

export function columnsOf(resource: Sf6Resource, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(columnFields(resource)
    .filter((field) => !field.readOnly && field.key in fields)
    .map((field) => [field.column, fields[field.key]]));
}

/** Ordinary SF6 saves and Inbox routing share the exact column/child conversion. */
export function sf6SavePayload(resource: Sf6Resource, fields: Record<string, unknown>) {
  const results = fields.results as Sf6ResultInput[] | undefined;
  return {
    row: columnsOf(resource, fields),
    starts: "starts" in fields ? fields.starts : null,
    results: results === undefined ? null : results.map((result) => ({
      kind: result.kind, opponent_action: result.opponentAction, outcome: result.outcome, next: result.next,
      ...(result.hitType ? { hit_type: result.hitType } : {}),
    })),
  };
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

async function fetchItem(info: Connection, resource: Sf6Resource, id: number) {
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("id", `eq.${id}`);
  endpoint.searchParams.set("select", selectOf(resource));
  const rows = await request(info, table, endpoint);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned an unexpected number of rows.`);
  return toSf6Item(resource, rows[0]);
}

/**
 * 手順を親・始動・結果まとめてRPCで保存し、取り直した手順と状況の全件を返す（新しく作った局面を画面に反映するため）。
 * starts / results を省いた編集では子表を変えない。
 */
async function saveSequence(info: Connection, id: number | null, updatedAt: string | null, fields: Record<string, unknown>) {
  const payload = sf6SavePayload("sequences", fields);
  const savedId = await rpc(info, "sf6_save_sequence", {
    p_id: id,
    p_updated_at: updatedAt,
    p_row: payload.row,
    p_starts: payload.starts,
    p_results: payload.results,
  });
  const [item, situations] = await Promise.all([fetchItem(info, "sequences", savedId), fetchAll(info, "situations")]);
  return { item, situations: situations.map((row) => toSf6Item("situations", row)).filter((entry) => entry !== null) };
}

export async function createSf6Item(env: DashboardEnv, resource: Sf6Resource, input: Sf6CreateInput) {
  const info = connection(env);
  if (spec(resource).write === "rpc") return saveSequence(info, null, null, input.fields);
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("select", selectOf(resource));
  const rows = await request(info, table, endpoint, { method: "POST", body: JSON.stringify(columnsOf(resource, input.fields)) });
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} created an unexpected number of rows.`);
  return toSf6Item(resource, rows[0]);
}

export async function updateSf6Item(env: DashboardEnv, resource: Sf6Resource, input: Sf6UpdateInput, now = new Date()) {
  const info = connection(env);
  if (spec(resource).write === "rpc") return saveSequence(info, input.id, input.updatedAt, input.fields);
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
  // 手順は練習メニューの sequence_ids からも外す（配列なので外部キーで消えない）
  if (spec(resource).write === "rpc") return { id: await rpc(info, "sf6_delete_sequence", { p_id: input.id }) };
  const { table } = spec(resource);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("select", "id");
  const rows = await request(info, table, endpoint, { method: "DELETE" });
  if (rows.length === 0) throw new DashboardError("SF6_NOT_FOUND", `${table} row was not found.`, 404);
  return { id: input.id };
}

// ---------- 技データ（GET /api/sf6/moves） ----------

const MOVE_COLUMNS = [
  "id", "character", "sort_order", "category", "name", "command", "startup_text", "active_text", "recovery_text", "hit_text",
  "block_text", "cancel_text", "damage_text", "scaling_text", "drive_gain_text", "drive_loss_text", "sa_gain_text",
  "attribute_text", "notes", "startup", "on_hit", "hit_knockdown", "on_block", "counter_override", "punish_counter_override",
];

function camelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** 1キャラの技データ（公式の並び順）と版。登録のないキャラは set: null, moves: []。 */
export async function loadSf6Moves(env: DashboardEnv, character: string) {
  const info = connection(env);
  const setEndpoint = new URL("/rest/v1/sf6_move_sets", info.url);
  setEndpoint.searchParams.set("character", `eq.${character}`);
  setEndpoint.searchParams.set("select", "data_version,source_url,checked_on");
  const movesEndpoint = new URL("/rest/v1/sf6_moves", info.url);
  movesEndpoint.searchParams.set("character", `eq.${character}`);
  movesEndpoint.searchParams.set("select", MOVE_COLUMNS.join(","));
  movesEndpoint.searchParams.set("order", "sort_order.asc");
  const [sets, rows] = await Promise.all([
    request(info, "sf6_move_sets", setEndpoint),
    request(info, "sf6_moves", movesEndpoint),
  ]);
  const set = sets.find(isPlainObject);
  return {
    character,
    set: set ? { dataVersion: set.data_version, sourceUrl: set.source_url, checkedOn: set.checked_on } : null,
    moves: set ? rows.filter(isPlainObject).map((row) => Object.fromEntries(MOVE_COLUMNS.map((column) => [camelCase(column), row[column] ?? null]))) : [],
  };
}
