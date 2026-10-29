import { readReviewJson, validateReviewQueueRequest, isRecord } from "../_shared/reviewQueue.ts";
import {
  fetchSupabasePage,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** 画面から自動タグを外す・戻すときの操作名。 */
export const AUTO_TAG_ACTION = "auto-tag";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 自動タグ（#93）。GETは外されていない自動タグの一覧（ナレッジ・タグ・近さ）。
 * POSTは1件を外す（remove）・戻す（restore）。外した自動タグは、次の自動処理でも付け直されない。
 * 自分で付けたタグ（knowledge.tags）と出題には関わらない。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    const pagination = readPagination(context.request);
    if (!pagination.ok) return pagination.response;
    return fetchSupabasePage(context.env, {
      table: "knowledge_auto_tags",
      params: new URLSearchParams({
        select: "knowledge_id,tag,similarity",
        removed_at: "is.null",
        order: "knowledge_id.asc,similarity.desc",
      }),
    }, pagination.value);
  }
  if (context.request.method !== "POST") return methodNotAllowed("GET, POST");

  const guard = validateReviewQueueRequest(context.request, AUTO_TAG_ACTION);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const body = json.value;
  if (!isRecord(body) || Object.keys(body).sort().join(",") !== "action,knowledge_id,tag") {
    return jsonResponse({ error: "入力内容の形式が正しくありません。" }, 400);
  }
  if (body.action !== "remove" && body.action !== "restore") return jsonResponse({ error: "操作の種類が正しくありません。" }, 400);
  if (typeof body.knowledge_id !== "string" || !UUID_PATTERN.test(body.knowledge_id)) {
    return jsonResponse({ error: "ナレッジのIDが正しくありません。" }, 400);
  }
  if (typeof body.tag !== "string" || !body.tag.trim() || body.tag.length > 40) {
    return jsonResponse({ error: "タグが正しくありません。" }, 400);
  }

  const updated = await requestSupabaseRows(context.env, {
    table: "knowledge_auto_tags",
    method: "PATCH",
    params: new URLSearchParams({
      knowledge_id: `eq.${body.knowledge_id.toLowerCase()}`,
      tag: `eq.${body.tag}`,
      select: "knowledge_id,tag,removed_at",
    }),
    body: { removed_at: body.action === "remove" ? new Date().toISOString() : null },
  });
  if (!updated.ok) return updated.response;
  if (updated.rows.length !== 1) return jsonResponse({ error: "対象の自動タグが見つかりません。" }, 404);
  return jsonResponse(updated.rows[0]);
};
