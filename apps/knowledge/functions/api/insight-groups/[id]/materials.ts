import { readGroupId, validateGroupRequest } from "../../../_shared/insightGroupValidation.ts";
import { loadQuestionMaterials, readMaterialChange } from "../../../_shared/questionMaterials.ts";
import { readReviewJson } from "../../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../../_shared/supabaseRest.ts";
import type { VoyageEnv } from "../../../_shared/voyageClient.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & VoyageEnv;
  params: { id?: string | string[] };
}

/**
 * 問いの材料。GETは問いに近いナレッジ・示唆・日記と、外したものを返す（問い文が変わっていれば、
 * その場で問い文をembeddingにし直す）。POSTは材料を外す・戻す。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method !== "GET" && method !== "POST") return methodNotAllowed("GET, POST");
  const id = readGroupId(context.params.id);
  if (!id) return jsonResponse({ error: "IDの形式が正しくありません。" }, 400);

  if (method === "GET") {
    try {
      const result = await loadQuestionMaterials(context.env, id);
      if (!result.ok) return jsonResponse({ error: result.error }, result.status);
      return jsonResponse({ materials: result.materials, excluded: result.excluded, note: result.note });
    } catch (error) {
      console.error("Question materials failed", error instanceof Error ? error.message : "unknown error");
      return jsonResponse({ error: "問いの材料を取得できませんでした。" }, 502);
    }
  }

  const guard = validateGroupRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const change = readMaterialChange(json.value);
  if (!change.ok) return jsonResponse({ error: change.error }, 400);
  const { action, sourceType, sourceId } = change.value;

  const result = action === "exclude"
    ? await requestSupabaseRows(context.env, {
      table: "question_material_exclusions",
      method: "POST",
      params: new URLSearchParams({ on_conflict: "group_id,source_type,source_id", select: "group_id" }),
      body: { group_id: id, source_type: sourceType, source_id: sourceId },
      preferResolution: "ignore-duplicates",
    })
    : await requestSupabaseRows(context.env, {
      table: "question_material_exclusions",
      method: "DELETE",
      params: new URLSearchParams({
        group_id: `eq.${id}`, source_type: `eq.${sourceType}`, source_id: `eq.${sourceId}`, select: "group_id",
      }),
    });
  if (!result.ok) return result.response;
  return jsonResponse({ group_id: id, action, source_type: sourceType, source_id: sourceId });
};
