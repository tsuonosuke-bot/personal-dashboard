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

/**
 * 期限が来た「出題待ち」の問題を、今の優先度順に返す。正解の選択肢は返さない。
 * 出しただけの問題は回答されるまで出題待ちのまま残る。
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

  let rows: unknown;
  try {
    rows = await callRpc(context.env, "serve_review_queue", {
      p_limit: limit,
      p_categories: categories.length > 0 ? categories : null,
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
