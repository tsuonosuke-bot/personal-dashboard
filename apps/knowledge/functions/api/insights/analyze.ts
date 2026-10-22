import { inFilter, jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../../_shared/supabaseRest.ts";
import { callAnthropicTool, QUIZ_EFFORT, QUIZ_MAX_TOKENS, QUIZ_MODEL, type AnthropicEnv } from "../../_shared/anthropicClient.ts";
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
  /** そのテーマを問いとして保存するときの、思い出すための問い文の下書き。無ければ空文字。 */
  guiding_question: string;
  summary: string;
  importance: string;
  insight_ids: number[];
}

const SYSTEM_PROMPT = `あなたは、学習者が自分の学びに残した「示唆」（このナレッジを自分はどう役立てられるか、という付箋メモ）を読み解く伴走者です。
複数のナレッジにまたがって繰り返し現れる考え方・関心・行動方針を見つけ、学習者自身が何を大事にしているかに気づけるようにまとめてください。

- テーマは2〜${MAX_THEMES}件。単なるカテゴリ分け（英語、ITなど）ではなく、示唆の中身に共通する考え方や行動でまとめる
- 異なるナレッジから2件以上の示唆が集まるテーマを優先する。1件だけでも特に重要なら入れてよい
- title は短い言い切り（120文字以内）。学習者がそのまま問いのテーマ名として保存できる言葉にする
- guiding_question は、学習者がこのテーマの示唆を自分で思い出すための問い（300文字以内、「〜には？」「〜とき、どう判断する？」の形）。答えそのものを書かない
- summary はそのテーマで学習者が繰り返し考えていることを2〜3文で、学習者の言葉を尊重して書く
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
            guiding_question: { type: "string" },
            summary: { type: "string" },
            importance: { type: "string" },
            insight_ids: { type: "array", minItems: 1, items: { type: "integer" } },
          },
          required: ["title", "guiding_question", "summary", "importance", "insight_ids"],
        },
      },
    },
    required: ["themes"],
  },
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 実際に送る内容と、出力に影響する条件をまとめて照合する。 */
export async function insightAnalysisHash(userText: string): Promise<string> {
  const input = JSON.stringify({ version: 1, userText, system: SYSTEM_PROMPT, tool: TOOL,
    model: QUIZ_MODEL, effort: QUIZ_EFFORT, maxTokens: QUIZ_MAX_TOKENS });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** AIの出力を検証し、渡した示唆のIDだけを残す。形が崩れたテーマは捨てる。 */
export function readThemes(input: unknown, knownIds: ReadonlySet<number>): InsightTheme[] | null {
  if (typeof input !== "object" || input === null || !Array.isArray((input as { themes?: unknown }).themes)) return null;
  const themes: InsightTheme[] = [];
  for (const raw of (input as { themes: unknown[] }).themes.slice(0, MAX_THEMES)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const title = text(record.title, 120);
    // 問い文は保存時に学習者が直せるので、欠けても長すぎてもテーマ自体は捨てない。
    const guidingQuestion = text(record.guiding_question, 300) ?? "";
    const summary = text(record.summary, 1_000);
    const importance = text(record.importance, 1_000);
    const ids = Array.isArray(record.insight_ids)
      ? [...new Set(record.insight_ids.filter((id): id is number => Number.isSafeInteger(id) && knownIds.has(id as number)))]
      : [];
    if (!title || !summary || !importance || ids.length === 0) continue;
    themes.push({ title, guiding_question: guidingQuestion, summary, importance, insight_ids: ids });
  }
  return themes.length > 0 ? themes : null;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const reading = context.request.method === "GET";
  if (!reading && context.request.method !== "POST") return methodNotAllowed("GET, POST");
  let force = false;
  if (!reading) {
    const guard = validateInsightRequest(context.request, false);
    if (guard) return jsonResponse({ error: guard.error }, guard.status);
    let raw: string;
    try { raw = await context.request.text(); } catch { return jsonResponse({ error: "リクエストを読み取れませんでした。" }, 400); }
    if (raw.length > 1_000) return jsonResponse({ error: "リクエストが大きすぎます。" }, 413);
    if (raw.trim()) {
      if (!context.request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return jsonResponse({ error: "JSON形式で送信してください。" }, 415);
      }
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return jsonResponse({ error: "JSONの形式が正しくありません。" }, 400); }
      if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.force !== "boolean") {
        return jsonResponse({ error: "再分析の指定が正しくありません。" }, 400);
      }
      force = body.force;
    }
  }

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
    if (reading) return jsonResponse(null);
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

  const inputHash = await insightAnalysisHash(userText);
  const cached = await requestSupabaseRows(context.env, {
    table: "insight_analysis_cache",
    params: new URLSearchParams({ select: "input_hash,analysis,analyzed_at", input_hash: `eq.${inputHash}`, limit: "1" }),
  });
  // 保存先を読めないままAIへ再送しない。未適用のmigrationもここで止まる。
  if (!cached.ok) return cached.response;
  const row = cached.rows[0];
  const knownIds = new Set(rows.map((item) => item.id));
  const cachedThemes = isRecord(row) && isRecord(row.analysis) ? readThemes(row.analysis, knownIds) : null;
  const usable = isRecord(row) && row.input_hash === inputHash && isRecord(row.analysis)
    && row.analysis.analyzed_count === rows.length && cachedThemes
    && Array.isArray(row.analysis.themes) && cachedThemes.length === row.analysis.themes.length
    && typeof row.analyzed_at === "string" && !Number.isNaN(Date.parse(row.analyzed_at));
  if ((reading || !force) && usable) return jsonResponse({
    themes: cachedThemes, analyzed_count: rows.length, input_hash: inputHash,
    analyzed_at: row.analyzed_at, reused: true, saved: true,
  });
  if (reading) return jsonResponse(null);

  const result = await callAnthropicTool(context.env, {
    model: QUIZ_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: QUIZ_MAX_TOKENS,
    effort: QUIZ_EFFORT,
    // 1回きりの呼び出しなのでsystemはキャッシュしない（書き込みの分だけ高くなる）。
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
  const themes = readThemes(result.input, knownIds);
  if (!themes) {
    return jsonResponse({
      error: "示唆のまとめに失敗しました。",
      stage: "AI応答の確認",
      reason: "AIの応答に、渡した示唆を根拠にしたテーマが含まれていませんでした。",
      action: "もう一度実行してください。",
    }, 502);
  }
  const analyzedAt = new Date().toISOString();
  const analysis = { themes, analyzed_count: rows.length };
  const saved = await requestSupabaseRows(context.env, {
    table: "insight_analysis_cache", method: "POST", preferResolution: "merge-duplicates",
    params: new URLSearchParams({ on_conflict: "input_hash" }),
    body: { input_hash: inputHash, analysis, analyzed_at: analyzedAt },
  });
  return jsonResponse({ ...analysis, input_hash: inputHash, analyzed_at: analyzedAt,
    reused: false, saved: saved.ok && saved.rows.some((item) => isRecord(item) && item.input_hash === inputHash) });
};
