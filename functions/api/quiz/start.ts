import {
  inFilter,
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  callAnthropicTool,
  QUIZ_MAX_TOKENS,
  QUIZ_MODEL,
  type AnthropicEnv,
} from "../../_shared/anthropicClient.ts";
import {
  readQuizJsonBody,
  validateQuizRequest,
  validateStartRequest,
} from "../../_shared/quizValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv;
}

/** 1件あたり直近何回分のつまずきメモを出題の参考に渡すか。 */
const NOTES_PER_ITEM = 2;
const NOTE_FETCH_LIMIT = 200;

interface PickedItem {
  id: string;
  title: string;
  explanation: string | null;
  category: string;
  mastery: string;
  times_asked: number;
  pool: string;
}

function isPickedItem(value: unknown): value is PickedItem {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string"
    && (record.explanation === null || typeof record.explanation === "string")
    && typeof record.category === "string" && typeof record.mastery === "string"
    && typeof record.times_asked === "number" && typeof record.pool === "string";
}

/** 同じカテゴリが連続しないよう出題順だけ入れ替える。DBが選んだ問題の差し替えはしない。 */
function spreadCategories(items: PickedItem[]): PickedItem[] {
  const rest = [...items];
  const ordered: PickedItem[] = [];
  while (rest.length > 0) {
    const previous = ordered[ordered.length - 1];
    const found = rest.findIndex((item) => item.category !== previous?.category);
    ordered.push(...rest.splice(found < 0 ? 0 : found, 1));
  }
  return ordered;
}

/** 0件の理由を「対象の知識がない」と「本日出題済み」で切り分ける。 */
async function emptyReason(
  env: SupabaseEnv,
  categories: string[],
): Promise<"no_knowledge" | "done_today"> {
  const params = new URLSearchParams({ select: "id", archived: "eq.false", limit: "1" });
  if (categories.length > 0) params.set("category", inFilter(categories));
  const result = await requestSupabaseRows(env, { table: "knowledge", params, count: "exact" });
  if (!result.ok) return "no_knowledge";
  return (result.total ?? 0) > 0 ? "done_today" : "no_knowledge";
}

const SYSTEM_PROMPT = `あなたはナレッジDBの復習クイズの出題者です。渡された知識項目ごとに、1問ずつ復習用の
問題文を日本語で作成してください。

## 問題文の作り方

- カテゴリに応じて問い方を変える。
  - 英語（tagsに単語/文法）: 日本語の意味から英語を言わせる、構文の意味や使い方を説明させる、
    例文の空所を埋めさせる、など「使えるか」を問う形にする
  - 歴史 / 軍事史 / 地理: 出来事・年号・人物・場所を特定させる
  - ビジネス / テクノロジー / 経済 / 金融・会計: 用語の定義と、何の役に立つか・どの場面で使うかを問う
  - 名言 / 哲学 / 気づき / 脳科学: 誰の言葉か、何を主張しているか、何が示唆されるかを問う
- 例: title「1453 コンスタンティノープル陥落」→「1453年に起きた、ビザンツ帝国の終焉を決定づけた
  出来事は？」
- 一問一答として答えられる粒度にする。「〜について説明してください」だけの漠然とした問題文にしない。
- past_notes（前回の回答でどこを外したか）があれば、そこを突く問題文にする。
- times_asked が 0 の項目は初出題。ひねらず、核心をまっすぐ問う。

## 禁止事項

- title の語句をそのまま問題文に含めない（答えがバレる）。
- explanation の例文をそのまま引用しない。答えの語句を含む場合は「＿＿＿」で伏せる。

## 出力前の自己チェック

各問を自分で読み返し、「この文面だけを見て答えが書いてあると気づくか？」を確認する。
答えの語句（英単語・熟語・人名・年号など）が問題文に含まれていたら作り直すこと。

与えられたid一つにつき、questionsに必ず1件、同じidで出力する。`;

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");

  const guardError = validateQuizRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readQuizJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateStartRequest(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const { categories, limit } = validated.value;
  const picked = await requestSupabaseFunction(context.env, "pick_quiz", {
    p_include: categories.length > 0 ? categories : null,
    p_exclude: null,
    p_limit: limit,
    p_include_mastered: false,
  });
  if (!picked.ok) return picked.response;
  if (!Array.isArray(picked.data)) {
    return jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502);
  }
  const rows = picked.data.filter(isPickedItem);
  if (rows.length !== picked.data.length) {
    return jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502);
  }
  if (rows.length === 0) {
    return jsonResponse({ items: [], reason: await emptyReason(context.env, categories) });
  }

  const items = spreadCategories(rows);
  const ids = items.map((item) => item.id);

  const [tagRows, noteRows] = await Promise.all([
    requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ id: inFilter(ids), select: "id,tags" }),
    }),
    requestSupabaseRows(context.env, {
      table: "quiz_log",
      params: new URLSearchParams({
        knowledge_id: inFilter(ids),
        select: "knowledge_id,quality,verdict,note,asked_on",
        order: "asked_on.desc,id.desc",
        limit: String(NOTE_FETCH_LIMIT),
      }),
    }),
  ]);
  if (!tagRows.ok) return tagRows.response;
  if (!noteRows.ok) return noteRows.response;

  const tagsById = new Map<string, string[]>();
  for (const row of tagRows.rows) {
    const { id, tags } = (row ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") continue;
    tagsById.set(id, Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : []);
  }

  const notesById = new Map<string, { asked_on: string; verdict: string; note: string }[]>();
  for (const row of noteRows.rows) {
    const { knowledge_id, note, verdict, asked_on } = (row ?? {}) as Record<string, unknown>;
    if (typeof knowledge_id !== "string" || typeof note !== "string" || !note.trim()) continue;
    const history = notesById.get(knowledge_id) ?? [];
    if (history.length >= NOTES_PER_ITEM) continue;
    history.push({
      asked_on: typeof asked_on === "string" ? asked_on : "",
      verdict: typeof verdict === "string" ? verdict : "",
      note: note.trim(),
    });
    notesById.set(knowledge_id, history);
  }

  const userText = JSON.stringify(items.map((item) => ({
    id: item.id,
    title: item.title,
    explanation: item.explanation ?? "",
    category: item.category,
    tags: tagsById.get(item.id) ?? [],
    mastery: item.mastery,
    times_asked: item.times_asked,
    past_notes: notesById.get(item.id) ?? [],
  })));

  const generated = await callAnthropicTool(context.env, {
    model: QUIZ_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: QUIZ_MAX_TOKENS,
    tool: {
      name: "submit_questions",
      description: "生成した問題文を送信する",
      input_schema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                question: { type: "string" },
              },
              required: ["id", "question"],
            },
          },
        },
        required: ["questions"],
      },
    },
  });
  if (!generated.ok) return jsonResponse({ error: generated.error }, generated.status);

  const questions = (generated.input as { questions?: unknown })?.questions;
  if (!Array.isArray(questions)) {
    return jsonResponse({ error: "AIの応答形式が正しくありません。" }, 502);
  }

  const byId = new Map<string, string>();
  for (const entry of questions) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, question } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof question !== "string") continue;
    const trimmed = question.trim();
    if (!trimmed) continue;
    byId.set(id, trimmed);
  }

  const responseItems: { id: string; question: string }[] = [];
  for (const item of items) {
    const question = byId.get(item.id);
    if (!question) {
      return jsonResponse({ error: "AIが一部の問題を生成しませんでした。" }, 502);
    }
    responseItems.push({ id: item.id, question });
  }

  return jsonResponse({
    items: responseItems,
    // プールFは期限前の前倒し出題。画面で一言添えるために知らせる。
    early: items.every((item) => item.pool === "F"),
  });
};
