import { loadRelatedKnowledge } from "../../../_shared/relatedKnowledge.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
  params: { id?: string | string[] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** このナレッジに意味の近いナレッジ・示唆・問い（答え合わせ画面の「関連」欄）。読み取りだけ。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const raw = context.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !UUID_PATTERN.test(id)) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);
  try {
    return jsonResponse({ items: await loadRelatedKnowledge(context.env, id.toLowerCase()) });
  } catch (error) {
    console.error("Related knowledge failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "関連ナレッジを取得できませんでした。" }, 502);
  }
};
