import { inFilter, jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";
import { callAnthropicTool, QUIZ_MAX_TOKENS, QUIZ_MODEL, type AnthropicEnv } from "../../_shared/anthropicClient.ts";
import { validateInsightRequest } from "../../_shared/insightValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv;
}

/** 新しい順にこの件数までをまとめる。付箋は短文なので、この件数でも入力は十分小さい。 */
export const MAX_ANALYZED_INSIGHTS = 300;
const MAX_THEMES = 8;

interface InsightRow {
  id: number;
  knowledge_id: string;
  body: string;
}

export interface InsightTheme {
  title: string;
  summary: string;
  importance: string;
  insight_ids: number[];
}

const SYSTEM_PROMPT = `あなたは、学習者が自分の学びに残した「示唆」（このナレッジを自分はどう役立てられるか、という付箋メモ）を読み解く伴走者です。
複数のナレッジにまたがって繰り返し現れる考え方・関心・行動方針を見つけ、学習者自身が何を大事にしているかに気づけるようにまとめてください。

- テーマは2〜${MAX_THEMES}件。単なるカテゴリ分け（英語、ITなど）ではなく、示唆の中身に共通する考え方や行動でまとめる
- 異なるナレッジから2件以上の示唆が集まるテーマを優先する。1件だけでも特に重要なら入れてよい
- title は短い言い切り、summary はそのテーマで学習者が繰り返し考えていることを2〜3文で、学習者の言葉を尊重して書く
- importance には、なぜそれが学習者にとって重要そうかを、示唆の出現回数や広がりを根拠に1〜2文で書く
- insight_ids には根拠にした示唆のIDだけを入れる。渡されていないIDを作らない
- 重要度が高い順に並べる`;

const TOOL = {
  name: "submit_insight_themes",
  description: "示唆をテーマごとにまとめた結果を返す。",
  input_schema: {
    type: "object",
    properties: {
      themes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_THEMES,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            importance: { type: "string" },
            insight_ids: { type: "array", minItems: 1, items: { type: "integer" } },
          },
          required: ["title", "summary", "importance", "insight_ids"],
        },
      },
    },
    required: ["themes"],
  },
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
}

/** AIの出力を検証し、渡した示唆のIDだけを残す。形が崩れたテーマは捨てる。 */
export function readThemes(input: unknown, knownIds: ReadonlySet<number>): InsightTheme[] | null {
  if (typeof input !== "object" || input === null || !Array.isArray((input as { themes?: unknown }).themes)) return null;
  const themes: InsightTheme[] = [];
  for (const raw of (input as { themes: unknown[] }).themes.slice(0, MAX_THEMES)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const title = text(record.title, 100);
    const summary = text(record.summary, 1_000);
    const importance = text(record.importance, 1_000);
    const ids = Array.isArray(record.insight_ids)
      ? [...new Set(record.insight_ids.filter((id): id is number => Number.isSafeInteger(id) && knownIds.has(id as number)))]
      : [];
    if (!title || !summary || !importance || ids.length === 0) continue;
    themes.push({ title, summary, importance, insight_ids: ids });
  }
  return themes.length > 0 ? themes : null;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateInsightRequest(context.request, false);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);

  const insights = await requestSupabaseRows(context.env, {
    table: "knowledge_insights",
    params: new URLSearchParams({
      select: "id,knowledge_id,body",
      order: "created_at.desc,id.desc",
      limit: String(MAX_ANALYZED_INSIGHTS),
    }),
  });
  if (!insights.ok) return insights.response;
  const rows = (insights.rows as InsightRow[]).filter((row) => Number.isSafeInteger(row.id) && typeof row.body === "string");
  if (rows.length < 2) {
    return jsonResponse({ error: "まとめるには示唆が2件以上必要です。" }, 400);
  }

  const knowledgeIds = [...new Set(rows.map((row) => row.knowledge_id))];
  const titles = new Map<string, string>();
  // IDを並べたURLが長くなりすぎないよう、少しずつ引く。
  for (let offset = 0; offset < knowledgeIds.length; offset += 80) {
    const knowledge = await requestSupabaseRows(context.env, {
      table: "knowledge",
      params: new URLSearchParams({ select: "id,title,category", id: inFilter(knowledgeIds.slice(offset, offset + 80)) }),
    });
    if (!knowledge.ok) return knowledge.response;
    for (const row of knowledge.rows as { id: string; title: string; category: string }[]) {
      titles.set(row.id, `${row.title}（${row.category}）`);
    }
  }

  const userText = [
    `示唆は${rows.length}件です。各行は「[示唆ID] ナレッジ名（カテゴリ）: 示唆」です。`,
    ...rows.map((row) => `[${row.id}] ${titles.get(row.knowledge_id) ?? "不明なナレッジ"}: ${row.body.replace(/\s+/g, " ")}`),
  ].join("\n");

  const result = await callAnthropicTool(context.env, {
    model: QUIZ_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: QUIZ_MAX_TOKENS,
    tool: TOOL,
  });
  if (!result.ok) {
    return jsonResponse({
      error: "示唆のまとめに失敗しました。",
      stage: result.truncated ? "AI応答の確認" : "AIへの接続",
      reason: result.error,
      action: result.action,
      reference: result.reference,
    }, result.status);
  }
  const themes = readThemes(result.input, new Set(rows.map((row) => row.id)));
  if (!themes) {
    return jsonResponse({
      error: "示唆のまとめに失敗しました。",
      stage: "AI応答の確認",
      reason: "AIの応答に、渡した示唆を根拠にしたテーマが含まれていませんでした。",
      action: "もう一度実行してください。",
    }, 502);
  }
  return jsonResponse({ themes, analyzed_count: rows.length });
};
