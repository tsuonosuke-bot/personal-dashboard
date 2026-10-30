import { MAX_CATEGORY_CHARS, MAX_QUIZ_CATEGORIES, MAX_QUIZ_LIMIT } from "../../_shared/quizValidation.ts";
import {
  callRpc,
  isRecord,
  readReviewJson,
  validateReviewQueueRequest,
} from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** ノートの復習（#96）で絞り込めるナレッジの数。テーマのノートは多くても30件ほど。 */
export const MAX_SERVE_KNOWLEDGE_IDS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 期限が来た「出題待ち」の問題を、今の優先度順に返す。正解の選択肢は返さない。
 * 出しただけの問題は回答されるまで出題待ちのまま残る。
 * `knowledge_ids` を渡すと、そのナレッジの問題だけを同じ順で返す（ノートの復習）。予定は変えない。
 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateReviewQueueRequest(context.request);
  if (guard) return guard;
  const json = await readReviewJson(context.request);
  if (!json.ok) return json.response;
  const body = isRecord(json.value) ? json.value : null;
  if (!body) return jsonResponse({ error: "リクエストの形式が正しくありません。" }, 400);

  const limit = body.limit ?? 15;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_QUIZ_LIMIT) {
    return jsonResponse({ error: `limitは1〜${MAX_QUIZ_LIMIT}の整数で指定してください。` }, 400);
  }
  const categories = body.categories ?? [];
  if (
    !Array.isArray(categories) || categories.length > MAX_QUIZ_CATEGORIES
    || !categories.every((category) => typeof category === "string" && category.trim()
      && category.length <= MAX_CATEGORY_CHARS)
  ) {
    return jsonResponse({ error: "categoriesは登録済みカテゴリ名の配列で指定してください。" }, 400);
  }

  const knowledgeIds = body.knowledge_ids;
  if (knowledgeIds !== undefined && (
    !Array.isArray(knowledgeIds) || knowledgeIds.length === 0 || knowledgeIds.length > MAX_SERVE_KNOWLEDGE_IDS
    || !knowledgeIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
  )) {
    return jsonResponse({ error: `knowledge_idsは1〜${MAX_SERVE_KNOWLEDGE_IDS}件のナレッジIDの配列で指定してください。` }, 400);
  }

  let rows: unknown;
  try {
    rows = knowledgeIds === undefined
      ? await callRpc(context.env, "serve_review_queue", {
        p_limit: limit,
        p_categories: categories.length > 0 ? categories : null,
      })
      : await callRpc(context.env, "serve_review_queue_filtered", {
        p_limit: limit,
        p_categories: categories.length > 0 ? categories : null,
        p_knowledge_ids: (knowledgeIds as string[]).map((id) => id.toLowerCase()),
      });
  } catch {
    return jsonResponse({ error: "出題できる問題を取得できませんでした。" }, 502);
  }
  if (!Array.isArray(rows)) return jsonResponse({ error: "復習キューの応答が正しくありません。" }, 502);
  const items = rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "number" || typeof row.knowledge_id !== "string"
      || typeof row.format !== "string" || typeof row.question !== "string") return [];
    return [{
      id: row.id,
      knowledge_id: row.knowledge_id,
      format: row.format,
      question: row.question,
      choices: Array.isArray(row.choices) ? row.choices.filter((choice) => typeof choice === "string") : null,
      category: typeof row.category === "string" ? row.category : "",
    }];
  });
  if (items.length !== rows.length) return jsonResponse({ error: "復習キューの応答が正しくありません。" }, 502);
  return jsonResponse({ items });
};
