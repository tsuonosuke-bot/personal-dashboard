import { callRpc, firstRow, isRecord } from "./reviewQueue.ts";
import { readSearchRow, SEMANTIC_SOURCE_TYPES, type SemanticSearchResult, type SemanticSourceType } from "./semanticSearch.ts";
import type { SupabaseEnv } from "./supabaseRest.ts";
import { EMBEDDING_MODEL, embedTexts, type VoyageEnv } from "./voyageClient.ts";

/**
 * 問いの材料（#95）。問い文を検索語としてembeddingにし（問い文が変わったときだけ作り直す）、
 * 近いナレッジ・示唆・日記を種類ごとに返す。外したものと、自分で入れた示唆は含まない。
 */

/** 種類ごとに並べる件数。 */
export const MATERIALS_PER_TYPE = 8;
/**
 * これより近さが低い材料は出さない。3つの問いで見た限り、0.45未満は問いとずれたもの
 * （1日の出来事がまとめて入った日記など）が多かった。
 */
export const MIN_MATERIAL_SIMILARITY = 0.45;

export interface QuestionExclusion {
  source_type: SemanticSourceType;
  source_id: string;
  title: string;
  body: string;
  excluded_at: string;
}

export type MaterialsResult =
  | { ok: true; materials: SemanticSearchResult[]; excluded: QuestionExclusion[]; note: string | null }
  | { ok: false; status: number; error: string };

function readExclusion(value: unknown): QuestionExclusion | null {
  if (!isRecord(value) || typeof value.source_type !== "string"
    || !(SEMANTIC_SOURCE_TYPES as readonly string[]).includes(value.source_type)) return null;
  if (typeof value.source_id !== "string" || typeof value.title !== "string" || typeof value.body !== "string"
    || typeof value.excluded_at !== "string") return null;
  return {
    source_type: value.source_type as SemanticSourceType,
    source_id: value.source_id,
    title: value.title,
    body: value.body,
    excluded_at: value.excluded_at,
  };
}

export async function loadQuestionMaterials(env: SupabaseEnv & VoyageEnv, groupId: number): Promise<MaterialsResult> {
  const state = firstRow(await callRpc(env, "question_material_state", { p_group_id: groupId, p_model: EMBEDDING_MODEL }));
  if (!state) return { ok: false, status: 404, error: "対象の問いが見つかりません。" };
  if (typeof state.guiding_question !== "string" || typeof state.input_hash !== "string" || typeof state.needs_embedding !== "boolean") {
    throw new Error("問いの状態の応答形式が正しくありません。");
  }

  let note: string | null = null;
  if (state.needs_embedding) {
    const embedded = await embedTexts(env, [state.guiding_question], "query");
    if (!embedded.ok) {
      // 材料は出せないが、外したものの一覧と問いの表示は続けられるようにする。
      note = embedded.status === 503
        ? "VOYAGE_API_KEY が未設定のため、材料を集められません。"
        : `材料を集められませんでした。${embedded.error}`;
    } else {
      await callRpc(env, "save_question_embedding", {
        p_group_id: groupId,
        p_input_hash: state.input_hash,
        p_model: EMBEDDING_MODEL,
        p_embedding: JSON.stringify(embedded.embeddings[0]),
      });
    }
  }

  const [rows, exclusions] = await Promise.all([
    note ? Promise.resolve([]) : callRpc(env, "list_question_materials", {
      p_group_id: groupId, p_model: EMBEDDING_MODEL, p_per_type: MATERIALS_PER_TYPE,
    }),
    callRpc(env, "list_question_exclusions", { p_group_id: groupId }),
  ]);
  if (!Array.isArray(rows) || !Array.isArray(exclusions)) throw new Error("問いの材料の応答形式が正しくありません。");
  const materials = rows.map(readSearchRow);
  const excluded = exclusions.map(readExclusion);
  if (materials.some((row) => row === null) || excluded.some((row) => row === null)) {
    throw new Error("問いの材料に必須項目の不足があります。");
  }
  const close = (materials as SemanticSearchResult[]).filter((row) => row.similarity >= MIN_MATERIAL_SIMILARITY);
  return { ok: true, materials: close, excluded: excluded as QuestionExclusion[], note };
}

export interface MaterialChange {
  action: "exclude" | "restore";
  sourceType: SemanticSourceType;
  sourceId: string;
}

/** 外す・戻すの要求。キーは action・source_type・source_id の3つだけ。 */
export function readMaterialChange(value: unknown): { ok: true; value: MaterialChange } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "入力内容の形式が正しくありません。" };
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "action,source_id,source_type") return { ok: false, error: "入力内容の形式が正しくありません。" };
  if (value.action !== "exclude" && value.action !== "restore") return { ok: false, error: "操作の種類が正しくありません。" };
  if (typeof value.source_type !== "string" || !(SEMANTIC_SOURCE_TYPES as readonly string[]).includes(value.source_type)) {
    return { ok: false, error: "材料の種類が正しくありません。" };
  }
  if (typeof value.source_id !== "string" || !/^[0-9A-Za-z-]{1,64}$/.test(value.source_id)) {
    return { ok: false, error: "材料のIDが正しくありません。" };
  }
  return { ok: true, value: { action: value.action, sourceType: value.source_type as SemanticSourceType, sourceId: value.source_id } };
}
