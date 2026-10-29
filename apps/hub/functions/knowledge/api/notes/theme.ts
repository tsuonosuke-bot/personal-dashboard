import { loadThemeNote, readThemeMaterialChange, readThemeTag } from "../../_shared/notes.ts";
import { readReviewJson, validateReviewQueueRequest } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** 画面からテーマの材料を外す・戻すときの操作名。 */
export const NOTE_ACTION = "knowledge-note";

/**
 * テーマのノート（#96）。GET `?tag=` はそのテーマに集まったナレッジ・示唆・日記と、外したもの。
 * POST は示唆・日記をそのテーマから外す・戻す。外したものは、次に集め直しても戻らない。
 * ナレッジは自動タグを外して抜く（/api/auto-tags）。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method === "GET") {
    const tag = readThemeTag(new URL(context.request.url).searchParams.get("tag"));
    if (!tag) return jsonResponse({ error: "テーマを指定してください。" }, 400);
    try {
      const note = await loadThemeNote(context.env, tag);
      if (!note) return jsonResponse({ error: "対象のテーマが見つかりません。" }, 404);
      return jsonResponse({ tag, ...note });
    } catch (error) {
      console.error("Theme note failed", error instanceof Error ? error.message : "unknown error");
      return jsonResponse({ error: "テーマのノートを取得できませんでした。" }, 502);
    }
  }
  if (method !== "POST") return methodNotAllowed("GET, POST");

  const guard = validateReviewQueueRequest(context.request, NOTE_ACTION);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const change = readThemeMaterialChange(json.value);
  if (!change.ok) return jsonResponse({ error: change.error }, 400);
  const { tag, action, sourceType, sourceId } = change.value;

  const result = action === "exclude"
    ? await requestSupabaseRows(context.env, {
      table: "theme_material_exclusions",
      method: "POST",
      params: new URLSearchParams({ on_conflict: "tag,source_type,source_id", select: "tag" }),
      body: { tag, source_type: sourceType, source_id: sourceId },
      preferResolution: "ignore-duplicates",
    })
    : await requestSupabaseRows(context.env, {
      table: "theme_material_exclusions",
      method: "DELETE",
      params: new URLSearchParams({
        tag: `eq.${tag}`, source_type: `eq.${sourceType}`, source_id: `eq.${sourceId}`, select: "tag",
      }),
    });
  if (!result.ok) return result.response;
  return jsonResponse({ tag, action, source_type: sourceType, source_id: sourceId });
};
