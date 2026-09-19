import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  callAnthropicTool,
  QUIZ_GENERATE_MODEL,
  type AnthropicEnv,
} from "../../_shared/anthropicClient.ts";
import {
  readQuizJsonBody,
  validateQuizRequest,
  validateStartRequest,
  type QuizMode,
} from "../../_shared/quizValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv;
}

const ENGLISH_CATEGORY = "英語";

interface PickedItem {
  id: string;
  title: string;
  explanation: string | null;
}

function isPickedItem(value: unknown): value is PickedItem {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string"
    && (record.explanation === null || typeof record.explanation === "string");
}

function categoryFilter(mode: QuizMode): { include: string[] | null; exclude: string[] | null } {
  if (mode === "english") return { include: [ENGLISH_CATEGORY], exclude: null };
  if (mode === "non_english") return { include: null, exclude: [ENGLISH_CATEGORY] };
  return { include: null, exclude: null };
}

const SYSTEM_PROMPT = `あなたはナレッジDBの復習クイズの出題者です。渡された知識項目（id / タイトル / 説明）ごとに、
1問ずつ復習用の問題文を日本語で作成してください。

厳守事項:
- タイトルの語句そのものを問題文に含めない（答えが分かってしまうため）。
- 説明文中の例文をそのまま引用しない。答えの語句が含まれる場合は「＿＿＿」のように伏せ字にする。
- 簡潔に。1〜3文程度。
- 与えられたid一つにつき、questionsに必ず1件、同じidで出力する。順不同でよい。`;

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");

  const guardError = validateQuizRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readQuizJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateStartRequest(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const { include, exclude } = categoryFilter(validated.value.mode);
  const picked = await requestSupabaseFunction(context.env, "pick_quiz", {
    p_include: include,
    p_exclude: exclude,
    p_limit: validated.value.limit,
    p_include_mastered: false,
  });
  if (!picked.ok) return picked.response;
  if (!Array.isArray(picked.data)) {
    return jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502);
  }
  const items = picked.data.filter(isPickedItem);
  if (items.length !== picked.data.length) {
    return jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502);
  }
  if (items.length === 0) {
    return jsonResponse({ items: [] });
  }

  const userText = JSON.stringify(items.map((item) => ({
    id: item.id,
    title: item.title,
    explanation: item.explanation ?? "",
  })));

  const generated = await callAnthropicTool(context.env, {
    model: QUIZ_GENERATE_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: 4_096,
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

  return jsonResponse({ items: responseItems });
};
