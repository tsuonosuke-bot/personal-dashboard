import { callRpc } from "../../_shared/reviewQueue.ts";
import { readIndexStatusRow } from "../../_shared/semanticSearch.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";
import { EMBEDDING_MODEL, type VoyageEnv } from "../../_shared/voyageClient.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & VoyageEnv;
}

/** 種類ごとに、検索できる件数（今の文とモデルでembedding済み）と対象の総数を返す。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  let rows: unknown;
  try {
    rows = await callRpc(context.env, "get_semantic_index_status", { p_model: EMBEDDING_MODEL });
  } catch {
    return jsonResponse({ error: "意味検索の索引の状態を確認できませんでした。" }, 502);
  }
  const items = Array.isArray(rows) ? rows.map(readIndexStatusRow) : null;
  if (!items || items.some((item) => item === null)) {
    return jsonResponse({ error: "意味検索の索引の応答が正しくありません。" }, 502);
  }
  return jsonResponse({
    model: EMBEDDING_MODEL,
    configured: Boolean(context.env.VOYAGE_API_KEY?.trim()),
    items,
  });
};
