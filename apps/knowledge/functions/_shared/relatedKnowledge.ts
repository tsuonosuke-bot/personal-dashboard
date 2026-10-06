import { callRpc, isRecord } from "./reviewQueue.ts";
import type { SupabaseEnv } from "./supabaseRest.ts";
import { EMBEDDING_MODEL } from "./voyageClient.ts";

/**
 * 1枚のナレッジに関連するもの（#97）。答え合わせ画面で、そのナレッジのembeddingに近い
 * 別のナレッジ・ほかのナレッジの示唆・問いを返す。embedding APIは呼ばない。
 * 出題・採点・復習予定には一切関わらない。
 */
export const RELATED_PER_KIND = 4;
/** 問いの材料と同じ基準。これより遠いものは関連として出さない。 */
export const RELATED_MIN_SIMILARITY = 0.45;

export type RelatedKind = "knowledge" | "insight" | "question";

export interface RelatedItem {
  kind: RelatedKind;
  /** ナレッジのuuid、示唆のid、問いのid。 */
  item_id: string;
  /** ナレッジ・示唆はナレッジの題名、問いは問いの名前。 */
  title: string;
  /** ナレッジの説明、示唆の本文、問いの問い文。 */
  body: string;
  knowledge_id: string | null;
  similarity: number;
}

const KINDS = new Set<RelatedKind>(["knowledge", "insight", "question"]);

export function readRelatedRow(value: unknown): RelatedItem | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !KINDS.has(value.kind as RelatedKind)) return null;
  if (typeof value.item_id !== "string" || typeof value.title !== "string" || typeof value.body !== "string") return null;
  if (typeof value.similarity !== "number" || !Number.isFinite(value.similarity)) return null;
  if (value.knowledge_id !== null && typeof value.knowledge_id !== "string") return null;
  return {
    kind: value.kind as RelatedKind,
    item_id: value.item_id,
    title: value.title,
    body: value.body,
    knowledge_id: value.knowledge_id as string | null,
    similarity: value.similarity,
  };
}

export async function loadRelatedKnowledge(env: SupabaseEnv, knowledgeId: string): Promise<RelatedItem[]> {
  const rows = await callRpc(env, "related_knowledge", {
    p_knowledge_id: knowledgeId,
    p_model: EMBEDDING_MODEL,
    p_per_kind: RELATED_PER_KIND,
    p_min_similarity: RELATED_MIN_SIMILARITY,
  });
  if (!Array.isArray(rows)) throw new Error("関連ナレッジの応答形式が正しくありません。");
  const items = rows.map(readRelatedRow);
  if (items.some((item) => item === null)) throw new Error("関連ナレッジに必須項目の不足があります。");
  return items as RelatedItem[];
}
