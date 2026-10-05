import { callRpc, isRecord } from "./reviewQueue.ts";
import type { SupabaseEnv } from "./supabaseRest.ts";
import { EMBEDDING_MODEL, embedTexts, MAX_EMBEDDING_INPUTS, type VoyageEnv } from "./voyageClient.ts";

/**
 * 意味検索（#45）。ナレッジ・示唆・日記のembeddingは semantic_embeddings にあり、
 * 埋め込む文はDB関数 semantic_sources() が作る。ここはバッチと検索の入出力だけを扱う。
 */

/** 画面から呼ぶ意味検索APIの操作名。同一オリジンとこのヘッダーの両方を要求する。 */
export const SEMANTIC_SEARCH_ACTION = "semantic-search";
export const SEMANTIC_SOURCE_TYPES = ["knowledge", "insight", "journal"] as const;
export type SemanticSourceType = typeof SEMANTIC_SOURCE_TYPES[number];

/** 1回のバッチでembeddingを付ける件数。初回の全件（約900件）も数回の実行で終わる。 */
export const EMBEDDING_BATCH_LIMIT = 512;
export const MAX_QUERY_CHARS = 500;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

type Env = SupabaseEnv & VoyageEnv;

export interface EmbeddingBatchSummary {
  /** skipped: キーが未設定か、付け直す項目が無かった。 */
  status: "succeeded" | "skipped" | "failed";
  picked: number;
  saved: number;
  tokens: number;
  note: string | null;
}

interface EmbeddingTarget {
  source_type: SemanticSourceType;
  source_id: string;
  input_text: string;
  input_hash: string;
}

function isSourceType(value: unknown): value is SemanticSourceType {
  return typeof value === "string" && (SEMANTIC_SOURCE_TYPES as readonly string[]).includes(value);
}

function isTarget(value: unknown): value is EmbeddingTarget {
  return isRecord(value) && isSourceType(value.source_type) && typeof value.source_id === "string"
    && typeof value.input_text === "string" && typeof value.input_hash === "string";
}

/**
 * embeddingが無い・文が変わった・モデルが違う項目にembeddingを付ける。API呼び出しが失敗したら
 * そこで止め、保存できた分はそのまま残す（残りは次の実行で拾い直す）。
 */
export async function runEmbeddingBatch(env: Env): Promise<EmbeddingBatchSummary> {
  const base = { picked: 0, saved: 0, tokens: 0 };
  if (!env.VOYAGE_API_KEY?.trim()) {
    return { ...base, status: "skipped", note: "VOYAGE_API_KEY が未設定のため、embeddingを付けませんでした。" };
  }

  const picked = await callRpc(env, "pick_semantic_embedding_targets", {
    p_model: EMBEDDING_MODEL,
    p_limit: EMBEDDING_BATCH_LIMIT,
  });
  if (!Array.isArray(picked) || !picked.every(isTarget)) throw new Error("embeddingの対象の応答形式が正しくありません。");
  if (picked.length === 0) return { ...base, status: "skipped", note: "新しくembeddingを付ける項目はありませんでした。" };

  let saved = 0;
  let tokens = 0;
  for (let start = 0; start < picked.length; start += MAX_EMBEDDING_INPUTS) {
    const chunk = picked.slice(start, start + MAX_EMBEDDING_INPUTS);
    const result = await embedTexts(env, chunk.map((item) => item.input_text), "document");
    if (!result.ok) {
      return {
        status: "failed",
        picked: picked.length,
        saved,
        tokens,
        note: `${result.error}（${picked.length}件中${saved}件を保存済み）`,
      };
    }
    tokens += result.tokens ?? 0;
    const count = await callRpc(env, "save_semantic_embeddings", {
      p_model: EMBEDDING_MODEL,
      p_items: chunk.map((item, index) => ({
        source_type: item.source_type,
        source_id: item.source_id,
        input_hash: item.input_hash,
        embedding: result.embeddings[index],
      })),
    });
    if (typeof count !== "number" || !Number.isSafeInteger(count)) throw new Error("embeddingの保存件数を確認できませんでした。");
    saved += count;
  }

  const changed = picked.length - saved;
  return {
    status: "succeeded",
    picked: picked.length,
    saved,
    tokens,
    note: changed > 0 ? `処理中に内容が変わった${changed}件は、次の実行で付け直します。` : null,
  };
}

export interface SemanticSearchRequest {
  query: string;
  types: SemanticSourceType[];
  limit: number;
}

/** 検索要求を検証する。種類を省くと全種類、件数を省くと20件。 */
export function readSearchRequest(value: unknown): { ok: true; value: SemanticSearchRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "検索内容を指定してください。" };
  const query = typeof value.query === "string" ? value.query.trim() : "";
  if (!query) return { ok: false, error: "検索する文を入力してください。" };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, error: `検索する文は${MAX_QUERY_CHARS}文字以内で入力してください。` };

  let types: SemanticSourceType[] = [...SEMANTIC_SOURCE_TYPES];
  if (value.types !== undefined) {
    if (!Array.isArray(value.types) || value.types.length === 0 || !value.types.every(isSourceType)) {
      return { ok: false, error: "検索対象の種類が正しくありません。" };
    }
    types = SEMANTIC_SOURCE_TYPES.filter((type) => (value.types as string[]).includes(type));
  }

  let limit = DEFAULT_SEARCH_LIMIT;
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > MAX_SEARCH_LIMIT) {
      return { ok: false, error: `件数は1〜${MAX_SEARCH_LIMIT}の整数で指定してください。` };
    }
    limit = value.limit;
  }
  return { ok: true, value: { query, types, limit } };
}

export interface SemanticSearchResult {
  source_type: SemanticSourceType;
  source_id: string;
  title: string;
  body: string;
  meta: string | null;
  knowledge_id: string | null;
  entry_date: string | null;
  similarity: number;
}

export function readSearchRow(value: unknown): SemanticSearchResult | null {
  if (!isRecord(value) || !isSourceType(value.source_type) || typeof value.source_id !== "string") return null;
  if (typeof value.title !== "string" || typeof value.body !== "string") return null;
  if (typeof value.similarity !== "number" || !Number.isFinite(value.similarity)) return null;
  const optional = (field: unknown) => (typeof field === "string" ? field : null);
  return {
    source_type: value.source_type,
    source_id: value.source_id,
    title: value.title,
    body: value.body,
    meta: optional(value.meta),
    knowledge_id: optional(value.knowledge_id),
    entry_date: optional(value.entry_date),
    similarity: value.similarity,
  };
}

/** 検索語をembeddingにし、近い順に返す。キーが無い・APIが失敗したときは理由つきで返す。 */
export async function searchSemantic(
  env: Env,
  request: SemanticSearchRequest,
): Promise<{ ok: true; results: SemanticSearchResult[] } | { ok: false; status: number; error: string }> {
  const embedded = await embedTexts(env, [request.query], "query");
  if (!embedded.ok) return { ok: false, status: embedded.status === 503 ? 503 : 502, error: embedded.error };
  const rows = await callRpc(env, "search_semantic", {
    p_embedding: JSON.stringify(embedded.embeddings[0]),
    p_model: EMBEDDING_MODEL,
    p_types: request.types,
    p_limit: request.limit,
  });
  if (!Array.isArray(rows)) throw new Error("検索結果の応答形式が正しくありません。");
  const results = rows.map(readSearchRow);
  if (results.some((row) => row === null)) throw new Error("検索結果に必須項目の不足があります。");
  return { ok: true, results: results as SemanticSearchResult[] };
}

export interface SemanticIndexStatus {
  source_type: SemanticSourceType;
  total: number;
  embedded: number;
  last_embedded_at: string | null;
}

export function readIndexStatusRow(value: unknown): SemanticIndexStatus | null {
  if (!isRecord(value) || !isSourceType(value.source_type)) return null;
  const count = (field: unknown) => (typeof field === "number" && Number.isSafeInteger(field) && field >= 0 ? field : null);
  const total = count(value.total);
  const embedded = count(value.embedded);
  if (total === null || embedded === null) return null;
  return {
    source_type: value.source_type,
    total,
    embedded,
    last_embedded_at: typeof value.last_embedded_at === "string" ? value.last_embedded_at : null,
  };
}
