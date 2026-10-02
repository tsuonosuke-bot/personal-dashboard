import {
  inFilter,
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import type { AnthropicEnv } from "../../_shared/anthropicClient.ts";
import {
  MAX_QUIZ_LIMIT,
  readQuizJsonBody,
  validateQuizRequest,
  validateStartRequest,
  type QuizFormat,
} from "../../_shared/quizValidation.ts";
import {
  allowedFormats,
  generateQuestions,
  generationIssue,
  groupRecentNotes,
  hasConsistentWordCount,
  isPickedItem,
  NOTES_PER_ITEM,
  shuffle,
  type PickedItem,
} from "../../_shared/questionGeneration.ts";
import {
  issueQuizToken,
  type QuizSigningEnv,
} from "../../_shared/quizSession.ts";

export { questionRevealsTitle } from "../../_shared/questionGeneration.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv & QuizSigningEnv;
}


interface QuizItem {
  id: string;
  question: string;
  format: QuizFormat;
  /** 四択のときだけ入る選択肢。他の形式ではnull。 */
  choices: string[] | null;
  /** 問題ID・本文・形式をサーバーへ安全に返すための署名済みトークン。 */
  token: string;
}

interface QuizStartErrorOptions {
  stage: string;
  reason: string;
  action: string;
  details?: string[];
  reference?: string;
}

function quizStartError(options: QuizStartErrorOptions, status = 502): Response {
  return jsonResponse({
    error: "問題生成に失敗しました。",
    ...options,
  }, status);
}

async function dependencyError(
  response: Response,
  stage: string,
  action: string,
): Promise<Response> {
  let reason = `必要なデータを取得できませんでした（HTTP ${response.status}）。`;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) reason = body.error.trim();
  } catch {
    // 内部APIがJSON以外を返した場合も、処理段階とHTTPステータスは画面へ返す。
  }
  return quizStartError({ stage, reason, action }, response.status);
}

/**
 * 同じカテゴリが連続しないよう出題順だけ入れ替える。DBが選んだ問題の差し替えはしない。
 * 再学習プールRなどの優先順は越えない。
 */
function spreadCategories(items: PickedItem[]): PickedItem[] {
  const ordered: PickedItem[] = [];
  for (let start = 0; start < items.length;) {
    const pool = items[start].pool;
    let end = start + 1;
    while (end < items.length && items[end].pool === pool) end += 1;
    const rest = items.slice(start, end);
    while (rest.length > 0) {
      const previous = ordered[ordered.length - 1];
      const found = rest.findIndex((item) => item.category !== previous?.category);
      ordered.push(...rest.splice(found < 0 ? 0 : found, 1));
    }
    start = end;
  }
  return ordered;
}

/** 0件の理由を「対象の知識がない」と「本日出題済み」で切り分ける。 */
async function emptyReason(
  env: SupabaseEnv,
  categories: string[],
): Promise<
  | { ok: true; reason: "no_knowledge" | "done_today" }
  | { ok: false; response: Response }
> {
  const params = new URLSearchParams({ select: "id", archived: "eq.false", limit: "1" });
  if (categories.length > 0) params.set("category", inFilter(categories));
  const result = await requestSupabaseRows(env, { table: "knowledge", params, count: "exact" });
  if (!result.ok) return result;
  if (result.total === null) {
    return { ok: false, response: jsonResponse({ error: "DBから件数を確認できませんでした。" }, 502) };
  }
  return { ok: true, reason: result.total > 0 ? "done_today" : "no_knowledge" };
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");

  const guardError = validateQuizRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readQuizJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateStartRequest(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const { categories, limit, format, mode, excludeIds } = validated.value;
  // 採点中の項目は選定関数へ渡せないため、その分だけ多めに選んでから除く（選定順は保つ）。
  const pickLimit = Math.min(MAX_QUIZ_LIMIT, limit + excludeIds.length);
  const picked = mode === "daily"
    ? await requestSupabaseFunction(context.env, "pick_daily_review_queue", { p_limit: pickLimit })
    : await requestSupabaseFunction(context.env, "pick_quiz", {
      p_include: categories.length > 0 ? categories : null,
      p_exclude: null,
      p_limit: pickLimit,
      p_include_mastered: false,
    });
  if (!picked.ok) return dependencyError(
    picked.response,
    "出題対象の選定",
    "DB接続とクイズ選定処理を確認して、もう一度出題してください。",
  );
  if (!Array.isArray(picked.data)) {
    return quizStartError({
      stage: "出題対象の選定",
      reason: "DBから想定外の応答を受信しました。",
      action: "クイズ選定処理の戻り値を確認してください。",
    });
  }
  const validRows = picked.data.filter(isPickedItem);
  if (validRows.length !== picked.data.length) {
    return quizStartError({
      stage: "出題対象の検証",
      reason: "DBから返った出題対象に必須項目の不足または型の不一致があります。",
      action: "クイズ選定処理の戻り値とDBマイグレーションを確認してください。",
    });
  }
  const excluded = new Set(excludeIds);
  const rows = validRows.filter((row) => !excluded.has(row.id.toLowerCase())).slice(0, limit);
  if (rows.length === 0 && validRows.length > 0) {
    return jsonResponse({ items: [], reason: "in_grading", mode });
  }
  if (rows.length === 0) {
    if (mode === "daily") {
      const status = await requestSupabaseFunction(context.env, "get_daily_review_status", { p_limit: limit });
      if (!status.ok) return dependencyError(
        status.response,
        "日次復習キューの確認",
        "DB接続と日次復習キュー処理を確認して、もう一度出題してください。",
      );
      if (!Array.isArray(status.data) || status.data.length !== 1) {
        return quizStartError({
          stage: "日次復習キューの確認",
          reason: "日次復習キューの応答件数または形式が正しくありません。",
          action: "日次復習キュー処理の戻り値を確認してください。",
        });
      }
      return jsonResponse({
        items: [],
        // Daily mode means "nothing is due now" even when every active card is
        // scheduled for the future. Do not mislabel that as an empty database.
        reason: "done_today",
        mode,
      });
    }
    const empty = await emptyReason(context.env, categories);
    if (!empty.ok) return dependencyError(
      empty.response,
      "出題対象件数の確認",
      "DB接続と対象カテゴリを確認して、もう一度出題してください。",
    );
    return jsonResponse({ items: [], reason: empty.reason });
  }

  const items = spreadCategories(rows);
  const ids = items.map((item) => item.id);

  const [tagRows, noteRows] = await Promise.all([
    requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ id: inFilter(ids), select: "id,tags" }),
    }),
    requestSupabaseFunction(context.env, "get_recent_quiz_notes", {
      p_knowledge_ids: ids,
      p_per_item: NOTES_PER_ITEM,
    }),
  ]);
  if (!tagRows.ok) return dependencyError(
    tagRows.response,
    "ナレッジ情報の取得",
    "DB接続とナレッジデータを確認して、もう一度出題してください。",
  );
  if (!noteRows.ok) return dependencyError(
    noteRows.response,
    "過去の復習記録の取得",
    "DB接続と復習履歴取得処理を確認して、もう一度出題してください。",
  );
  if (!Array.isArray(noteRows.data)) {
    return quizStartError({
      stage: "過去の復習記録の確認",
      reason: "DBから返った復習履歴の形式が正しくありません。",
      action: "復習履歴取得処理の戻り値を確認してください。",
    });
  }

  const tagsById = new Map<string, string[]>();
  for (const row of tagRows.rows) {
    const { id, tags } = (row ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") continue;
    tagsById.set(id, Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : []);
  }

  const notesById = groupRecentNotes(noteRows.data);

  const allowedById = new Map(items.map((item) => [item.id, allowedFormats(item, format)]));

  const first = await generateQuestions(context.env, items, allowedById, tagsById, notesById);
  if (!first.ok) {
    const { status, ...failure } = first.failure;
    return quizStartError(failure, status);
  }
  const byId = first.byId;
  const issueById = first.issueById;

  // 項目ごとに、問題文があり（四択なら選択肢も揃って）初めて成立とみなす。
  const isGenerated = (item: PickedItem): boolean => {
    return generationIssue(item, byId.get(item.id), issueById.get(item.id)) === null;
  };

  // 正常な問題を捨てず、条件を満たさない項目だけを除外する。
  // 自動再生成はAIクレジットを追加消費するため行わない。
  const generationFailures = items.flatMap((item, index) => {
    const issue = generationIssue(item, byId.get(item.id), issueById.get(item.id));
    return issue ? [{ position: index + 1, category: item.category, reason: issue }] : [];
  });
  const validItems = items.filter(isGenerated);
  if (validItems.length === 0) {
    return quizStartError({
      stage: "AI応答の確認",
      reason: `生成した${items.length}問すべてが出題条件を満たしませんでした。`,
      action: "追加のAI再生成は行っていません。下記の原因を確認して、必要な場合だけもう一度出題してください。",
      details: generationFailures.map((failure) =>
        `${failure.position}問目（${failure.category || "カテゴリなし"}）: ${failure.reason}`),
    });
  }
  if (generationFailures.length > 0) {
    console.warn("Quiz generation skipped invalid items", {
      requestedCount: items.length,
      deliveredCount: validItems.length,
      skippedCount: generationFailures.length,
    });
  }

  const responseItems: QuizItem[] = [];
  for (const item of validItems) {
    const generatedItem = byId.get(item.id);
    const itemFormat = generatedItem?.format;
    if (!generatedItem) {
      // validItemsで検証済み。ここへ到達した場合はサーバー側の整合性エラー。
      return quizStartError({
        stage: "問題データの組み立て",
        reason: "検証済みの問題データを取得できませんでした。",
        action: "もう一度出題してください。繰り返す場合はサーバーログを確認してください。",
      });
    }
    if (!hasConsistentWordCount(item, generatedItem.question)) {
      return quizStartError({
        stage: "問題データの組み立て",
        reason: "検証後に問題文の語数指定との不整合を検出しました。",
        action: "もう一度出題してください。繰り返す場合はサーバーログを確認してください。",
      });
    }
    // 四択は選択肢がそろって初めて成立するので、欠けていたら黙って自由記述にはしない。
    if (!itemFormat || itemFormat === "四択" && !generatedItem.choices) {
      return quizStartError({
        stage: "問題データの組み立て",
        reason: "AIが一部の選択肢を生成しませんでした。検証後に出題形式または選択肢との不整合を検出しました。",
        action: "もう一度出題してください。繰り返す場合はサーバーログを確認してください。",
      });
    }
    const choices = itemFormat === "四択" ? shuffle(generatedItem.choices!) : null;
    const signed = await issueQuizToken({
      id: item.id,
      question: generatedItem.question,
      format: itemFormat,
      choices,
      correctChoice: generatedItem.correctChoice,
    }, context.request, context.env);
    if (!signed.ok) return quizStartError({
      stage: "問題の安全な準備",
      reason: signed.error,
      action: "サーバーのクイズ署名設定を確認してください。",
    }, signed.status);
    responseItems.push({
      id: item.id,
      question: generatedItem.question,
      format: itemFormat,
      choices,
      token: signed.token,
    });
  }

  return jsonResponse({
    items: responseItems,
    requested_count: items.length,
    generation_failures: generationFailures,
    // プールFは期限前の前倒し出題。画面で一言添えるために知らせる。
    early: validItems.every((item) => item.pool === "F"),
    mode,
  });
};
