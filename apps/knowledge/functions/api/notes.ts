import { loadNoteTopics } from "../_shared/notes.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** ノートの一覧（#96）。すべての問いとテーマを、集まったナレッジ・示唆・日記の件数つきで返す。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  try {
    return jsonResponse({ items: await loadNoteTopics(context.env) });
  } catch (error) {
    console.error("Note topics failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "ノートの一覧を取得できませんでした。" }, 502);
  }
};
