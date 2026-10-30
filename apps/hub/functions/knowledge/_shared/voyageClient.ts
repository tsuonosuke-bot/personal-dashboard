export interface VoyageEnv {
  VOYAGE_API_KEY?: string;
}

/**
 * 意味検索のembeddingモデル。日本語を含む多言語に対応する。変えると semantic_embeddings.model が
 * 合わなくなり、次のバッチから全件を付け直す（それまで検索結果は空になる）。
 */
export const EMBEDDING_MODEL = "voyage-4";
/** semantic_embeddings.embedding の次元。モデルの既定値と揃える。 */
export const EMBEDDING_DIMENSIONS = 1024;
/** 1回のAPI呼び出しで送る件数の上限（APIの上限は1,000件）。 */
export const MAX_EMBEDDING_INPUTS = 128;

const API_URL = "https://api.voyageai.com/v1/embeddings";

export type EmbeddingInputType = "document" | "query";

export type EmbeddingResult =
  | { ok: true; embeddings: number[][]; tokens: number | null }
  | { ok: false; status: number; error: string };

function providerError(status: number): string {
  if (status === 401) return "embedding APIの認証に失敗しました（HTTP 401）。VOYAGE_API_KEYを確認してください。";
  if (status === 403) return "embedding APIを利用する権限がありません（HTTP 403）。";
  if (status === 429) return "embedding APIの利用上限に達しました（HTTP 429）。少し待ってから再実行してください。";
  if (status >= 500) return `embeddingサービスで一時的な障害が発生しています（HTTP ${status}）。`;
  return `embedding APIから応答を取得できませんでした（HTTP ${status}）。`;
}

function isVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS
    && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** 応答を検証し、入力と同じ順に並べ直す。件数・次元・番号が合わなければnull。 */
export function readEmbeddings(body: unknown, expected: number): { embeddings: number[][]; tokens: number | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const { data, usage } = body as { data?: unknown; usage?: { total_tokens?: unknown } };
  if (!Array.isArray(data) || data.length !== expected) return null;
  const embeddings: (number[] | undefined)[] = new Array(expected);
  for (const item of data) {
    if (typeof item !== "object" || item === null) return null;
    const { index, embedding } = item as { index?: unknown; embedding?: unknown };
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= expected) return null;
    if (embeddings[index] || !isVector(embedding)) return null;
    embeddings[index] = embedding;
  }
  const tokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : null;
  return { embeddings: embeddings as number[][], tokens };
}

/** 文の並びをembeddingにする。保存する文は "document"、検索語は "query" で送る。 */
export async function embedTexts(
  env: VoyageEnv,
  texts: string[],
  inputType: EmbeddingInputType,
): Promise<EmbeddingResult> {
  const apiKey = env.VOYAGE_API_KEY?.trim();
  if (!apiKey) return { ok: false, status: 503, error: "VOYAGE_API_KEY が未設定です。" };
  if (texts.length === 0) return { ok: true, embeddings: [], tokens: 0 };
  if (texts.length > MAX_EMBEDDING_INPUTS) {
    return { ok: false, status: 400, error: `一度に送れるのは${MAX_EMBEDDING_INPUTS}件までです。` };
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: texts,
        model: EMBEDDING_MODEL,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });
  } catch (error) {
    console.error("Voyage request failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, status: 502, error: "embedding APIへ接続できませんでした。" };
  }
  if (!response.ok) {
    console.error(`Voyage request failed with status ${response.status}`);
    return { ok: false, status: response.status, error: providerError(response.status) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, error: "embedding APIの応答を読み取れませんでした。" };
  }
  const parsed = readEmbeddings(body, texts.length);
  if (!parsed) return { ok: false, status: 502, error: "embedding APIの応答の形式が正しくありません。" };
  return { ok: true, ...parsed };
}
