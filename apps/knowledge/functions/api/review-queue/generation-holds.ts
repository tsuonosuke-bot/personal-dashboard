import { callRpc } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/**
 * 問題を作り直しても条件を満たさず、生成を保留しているカード。失敗の多い順に返す。
 * アーカイブ済みと、失敗の後に編集されたカードは含まない。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  let rows: unknown;
  try {
    rows = await callRpc(context.env, "list_review_generation_holds", {});
  } catch {
    return jsonResponse({ error: "問題を作れなかったカードを取得できませんでした。" }, 502);
  }
  if (!Array.isArray(rows)) return jsonResponse({ error: "問題を作れなかったカードの応答が正しくありません。" }, 502);
  return jsonResponse({ items: rows });
};
