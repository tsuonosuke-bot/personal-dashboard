import { MATERIALS_PER_TYPE, MIN_MATERIAL_SIMILARITY } from "./questionMaterials.ts";
import { callRpc, isRecord } from "./reviewQueue.ts";
import { SEMANTIC_SOURCE_TYPES, type SemanticSourceType } from "./semanticSearch.ts";
import { requestSupabaseRows, type SupabaseEnv } from "./supabaseRest.ts";
import { EMBEDDING_MODEL } from "./voyageClient.ts";

/**
 * 問い・テーマ別のノート（#96）。テーマは自動タグの語彙（#93）で、名前はタグそのもの。
 * テーマのノートは、そのタグが付いたナレッジ・そのナレッジの示唆・タグの位置に近い示唆と日記を集める。
 * 問いのノートは問いの材料（#95、questionMaterials.ts）をそのまま使う。
 */

/** テーマに近い示唆・日記を、種類ごとに並べる件数。 */
export const THEME_MATERIALS_PER_TYPE = 8;
/**
 * テーマ（タグのembeddingの平均）に近いとみなす下限。平均の位置は多くの文に近く出るため、
 * 問いの材料（0.45）より高い。10個のテーマで見た限り、0.65未満は別の話題が多かった。
 */
export const THEME_MIN_SIMILARITY = 0.65;

/** なぜノートに入ったか。own_tag・auto_tag はナレッジ、tagged_knowledge はそのナレッジの示唆。 */
export const THEME_ORIGINS = ["own_tag", "auto_tag", "tagged_knowledge", "nearby"] as const;
export type ThemeOrigin = typeof THEME_ORIGINS[number];

export interface NoteTopic {
  kind: "question" | "theme";
  /** 問いはid、テーマはタグ名。 */
  key: string;
  title: string;
  guiding_question: string | null;
  knowledge_count: number;
  insight_count: number;
  journal_count: number;
  /** 問い文のembeddingがまだ無い（ノートを開くと作る）ときはfalse。件数は自分で入れた示唆だけになる。 */
  materials_ready: boolean;
}

export interface ThemeMaterial {
  source_type: SemanticSourceType;
  source_id: string;
  title: string;
  body: string;
  meta: string | null;
  knowledge_id: string | null;
  entry_date: string | null;
  /** テーマとの意味の近さ。自分で付けたタグのナレッジや、embeddingがまだ無い示唆はnull。 */
  similarity: number | null;
  origin: ThemeOrigin;
}

export interface ThemeExclusion {
  source_type: SemanticSourceType;
  source_id: string;
  title: string;
  body: string;
  excluded_at: string;
}

const isSourceType = (value: unknown): value is SemanticSourceType =>
  typeof value === "string" && (SEMANTIC_SOURCE_TYPES as readonly string[]).includes(value);
const optional = (value: unknown) => (typeof value === "string" ? value : null);

function readTopic(value: unknown): NoteTopic | null {
  if (!isRecord(value) || (value.kind !== "question" && value.kind !== "theme")) return null;
  if (typeof value.key !== "string" || typeof value.title !== "string" || typeof value.materials_ready !== "boolean") return null;
  const counts = [value.knowledge_count, value.insight_count, value.journal_count];
  if (!counts.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return null;
  return {
    kind: value.kind,
    key: value.key,
    title: value.title,
    guiding_question: optional(value.guiding_question),
    knowledge_count: value.knowledge_count as number,
    insight_count: value.insight_count as number,
    journal_count: value.journal_count as number,
    materials_ready: value.materials_ready,
  };
}

function readMaterial(value: unknown): ThemeMaterial | null {
  if (!isRecord(value) || !isSourceType(value.source_type) || typeof value.source_id !== "string") return null;
  if (typeof value.title !== "string" || typeof value.body !== "string") return null;
  if (typeof value.origin !== "string" || !(THEME_ORIGINS as readonly string[]).includes(value.origin)) return null;
  const similarity = value.similarity;
  if (similarity !== null && (typeof similarity !== "number" || !Number.isFinite(similarity))) return null;
  return {
    source_type: value.source_type,
    source_id: value.source_id,
    title: value.title,
    body: value.body,
    meta: optional(value.meta),
    knowledge_id: optional(value.knowledge_id),
    entry_date: optional(value.entry_date),
    similarity,
    origin: value.origin as ThemeOrigin,
  };
}

function readExclusion(value: unknown): ThemeExclusion | null {
  if (!isRecord(value) || !isSourceType(value.source_type) || typeof value.source_id !== "string") return null;
  if (typeof value.title !== "string" || typeof value.body !== "string" || typeof value.excluded_at !== "string") return null;
  return {
    source_type: value.source_type,
    source_id: value.source_id,
    title: value.title,
    body: value.body,
    excluded_at: value.excluded_at,
  };
}

function readAll<T>(rows: unknown, read: (value: unknown) => T | null, label: string): T[] {
  if (!Array.isArray(rows)) throw new Error(`${label}の応答形式が正しくありません。`);
  const items = rows.map(read);
  if (items.some((item) => item === null)) throw new Error(`${label}に必須項目の不足があります。`);
  return items as T[];
}

/** すべての問いとテーマを、件数つきで返す。問いの件数は問いの材料と同じ件数・近さの基準で数える。 */
export async function loadNoteTopics(env: SupabaseEnv): Promise<NoteTopic[]> {
  const rows = await callRpc(env, "list_note_topics", {
    p_model: EMBEDDING_MODEL,
    p_question_per_type: MATERIALS_PER_TYPE,
    p_question_min_similarity: MIN_MATERIAL_SIMILARITY,
    p_theme_per_type: THEME_MATERIALS_PER_TYPE,
    p_theme_min_similarity: THEME_MIN_SIMILARITY,
  });
  return readAll(rows, readTopic, "ノートの一覧");
}

/** 1つのテーマのノート。語彙に無いタグはnullを返す。 */
export async function loadThemeNote(
  env: SupabaseEnv,
  tag: string,
): Promise<{ materials: ThemeMaterial[]; excluded: ThemeExclusion[] } | null> {
  const vocabulary = await requestSupabaseRows(env, {
    table: "knowledge_tag_vocabulary",
    params: new URLSearchParams({ select: "tag", tag: `eq.${tag}`, model: `eq.${EMBEDDING_MODEL}` }),
  });
  if (!vocabulary.ok) throw new Error("テーマの語彙を確認できませんでした。");
  if (vocabulary.rows.length === 0) return null;
  const [rows, exclusions] = await Promise.all([
    callRpc(env, "list_theme_materials", {
      p_tag: tag,
      p_model: EMBEDDING_MODEL,
      p_per_type: THEME_MATERIALS_PER_TYPE,
      p_min_similarity: THEME_MIN_SIMILARITY,
    }),
    callRpc(env, "list_theme_exclusions", { p_tag: tag }),
  ]);
  return {
    materials: readAll(rows, readMaterial, "テーマのノート"),
    excluded: readAll(exclusions, readExclusion, "テーマから外したもの"),
  };
}

const MAX_TAG_CHARS = 40;

/** テーマのタグ名。前後の空白は外し、1〜40文字に限る（語彙のタグと同じ制約）。 */
export function readThemeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim();
  return tag && tag.length <= MAX_TAG_CHARS ? tag : null;
}

export interface ThemeMaterialChange {
  tag: string;
  action: "exclude" | "restore";
  sourceType: "insight" | "journal";
  sourceId: string;
}

/**
 * テーマから示唆・日記を外す・戻す要求。キーは action・source_id・source_type・tag の4つだけ。
 * ナレッジは自動タグを外して抜く（/api/auto-tags）ので、ここでは受け付けない。
 */
export function readThemeMaterialChange(value: unknown): { ok: true; value: ThemeMaterialChange } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "入力内容の形式が正しくありません。" };
  if (Object.keys(value).sort().join(",") !== "action,source_id,source_type,tag") {
    return { ok: false, error: "入力内容の形式が正しくありません。" };
  }
  const tag = readThemeTag(value.tag);
  if (!tag) return { ok: false, error: "テーマが正しくありません。" };
  if (value.action !== "exclude" && value.action !== "restore") return { ok: false, error: "操作の種類が正しくありません。" };
  if (value.source_type !== "insight" && value.source_type !== "journal") {
    return { ok: false, error: "テーマから外せるのは示唆と日記です。" };
  }
  const pattern = value.source_type === "insight" ? /^[1-9]\d{0,15}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (typeof value.source_id !== "string" || !pattern.test(value.source_id)) {
    return { ok: false, error: "材料のIDが正しくありません。" };
  }
  return { ok: true, value: { tag, action: value.action, sourceType: value.source_type, sourceId: value.source_id } };
}
