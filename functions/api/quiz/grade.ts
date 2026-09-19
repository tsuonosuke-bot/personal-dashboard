import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  requestSupabaseRows,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  callAnthropicTool,
  QUIZ_GRADE_MODEL,
  type AnthropicEnv,
} from "../../_shared/anthropicClient.ts";
import {
  readQuizJsonBody,
  validateGradeRequest,
  validateQuizRequest,
  type GradeAnswerInput,
} from "../../_shared/quizValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv;
}

const QUIZ_FORMAT = "記述説明";

interface KnowledgeFact {
  id: string;
  title: string;
  explanation: string | null;
  next_review_on: string | null;
}

function isKnowledgeFact(value: unknown): value is KnowledgeFact {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string"
    && (record.explanation === null || typeof record.explanation === "string")
    && (record.next_review_on === null || typeof record.next_review_on === "string");
}

/** q値の基準に従って正誤を機械的に決める。AIの判定に任せずサーバー側でCHECK制約と整合させる。 */
function verdictForQuality(quality: number): "正解" | "部分正解" | "不正解" {
  if (quality >= 3) return "正解";
  if (quality === 2) return "部分正解";
  return "不正解";
}

async function fetchJstToday(env: SupabaseEnv): Promise<{ ok: true; value: string } | { ok: false; response: Response }> {
  const result = await requestSupabaseFunction(env, "jst_today", {});
  if (!result.ok) return result;
  const { data } = result;
  if (typeof data === "string") return { ok: true, value: data };
  if (typeof data === "object" && data !== null) {
    const value = Object.values(data as Record<string, unknown>)[0];
    if (typeof value === "string") return { ok: true, value };
  }
  return { ok: false, response: jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502) };
}

const SYSTEM_PROMPT = `あなたはナレッジDBの復習クイズの採点者です。各問題について、正解（タイトルと説明）と
ユーザーの回答を照合し、以下の基準でq値(0〜5)を判定してください。

| q | 状態 |
| --- | --- |
| 5 | 即答・完璧 |
| 4 | 正解だが詰めが甘い |
| 3 | 正解だが苦戦 |
| 2 | 部分正解 |
| 1 | かすった程度 |
| 0 | 全く思い出せない |

explanationにはユーザーへのフィードバック（正解の要点、何が良かったか・不足していたか）を書いてください。
noteにはユーザーが実際に何と答えて、どこでつまずいたかを具体的に書いてください。次回の出題時にも参照される
ため、抽象的な言い回しは避けてください。
与えられたid一つにつき、gradesに必ず1件、同じidで出力してください。`;

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");

  const guardError = validateQuizRequest(context.request);
  if (guardError) return jsonResponse({ error: guardError.error }, guardError.status);
  const json = await readQuizJsonBody(context.request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);
  const validated = validateGradeRequest(json.value);
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);
  const answers: GradeAnswerInput[] = validated.value;
  const ids = answers.map((a) => a.id);

  const knowledgeResult = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({
      id: `in.(${ids.join(",")})`,
      select: "id,title,explanation,next_review_on",
    }),
  });
  if (!knowledgeResult.ok) return knowledgeResult.response;
  const facts = knowledgeResult.rows.filter(isKnowledgeFact);
  if (facts.length !== ids.length || facts.length !== knowledgeResult.rows.length) {
    return jsonResponse({ error: "対象のナレッジが見つかりません。" }, 400);
  }
  const factById = new Map(facts.map((f) => [f.id, f]));

  const todayResult = await fetchJstToday(context.env);
  if (!todayResult.ok) return todayResult.response;

  const alreadyLoggedResult = await requestSupabaseRows(context.env, {
    table: "quiz_log",
    params: new URLSearchParams({
      select: "knowledge_id",
      asked_on: `eq.${todayResult.value}`,
      knowledge_id: `in.(${ids.join(",")})`,
    }),
  });
  if (!alreadyLoggedResult.ok) return alreadyLoggedResult.response;
  const alreadyLogged = new Set(
    alreadyLoggedResult.rows
      .map((row) => (row as { knowledge_id?: unknown }).knowledge_id)
      .filter((value): value is string => typeof value === "string"),
  );

  const userText = JSON.stringify(answers.map((a) => {
    const fact = factById.get(a.id)!;
    return {
      id: a.id,
      title: fact.title,
      explanation: fact.explanation ?? "",
      user_answer: a.answer,
    };
  }));

  const graded = await callAnthropicTool(context.env, {
    model: QUIZ_GRADE_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: 8_192,
    tool: {
      name: "submit_grades",
      description: "採点結果を送信する",
      input_schema: {
        type: "object",
        properties: {
          grades: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                quality: { type: "integer", minimum: 0, maximum: 5 },
                explanation: { type: "string" },
                note: { type: "string" },
              },
              required: ["id", "quality", "explanation", "note"],
            },
          },
        },
        required: ["grades"],
      },
    },
  });
  if (!graded.ok) return jsonResponse({ error: graded.error }, graded.status);

  const grades = (graded.input as { grades?: unknown })?.grades;
  if (!Array.isArray(grades)) {
    return jsonResponse({ error: "AIの応答形式が正しくありません。" }, 502);
  }

  interface Grade { id: string; quality: number; verdict: "正解" | "部分正解" | "不正解"; explanation: string; note: string }
  const gradeById = new Map<string, Grade>();
  for (const entry of grades) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, quality, explanation, note } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !factById.has(id)) continue;
    if (typeof quality !== "number" || !Number.isInteger(quality) || quality < 0 || quality > 5) continue;
    if (typeof explanation !== "string" || typeof note !== "string") continue;
    gradeById.set(id, { id, quality, verdict: verdictForQuality(quality), explanation, note: note.slice(0, 2_000) });
  }
  for (const id of ids) {
    if (!gradeById.has(id)) return jsonResponse({ error: "AIが一部の採点結果を生成しませんでした。" }, 502);
  }

  const toRecord = ids.filter((id) => !alreadyLogged.has(id));
  const recordedById = new Map<string, { next_review_on: string | null }>();
  if (toRecord.length > 0) {
    const batchArgs = toRecord.map((id) => {
      const grade = gradeById.get(id)!;
      return {
        id, quality: grade.quality, verdict: grade.verdict, note: grade.note, format: QUIZ_FORMAT,
      };
    });
    const recorded = await requestSupabaseFunction(context.env, "record_answers_batch", {
      p_answers: batchArgs,
    });
    if (!recorded.ok) return recorded.response;
    if (!Array.isArray(recorded.data)) {
      return jsonResponse({ error: "DBから想定外の応答を受信しました。" }, 502);
    }
    for (const row of recorded.data) {
      if (typeof row !== "object" || row === null) continue;
      const { id, next_review_on } = row as Record<string, unknown>;
      if (typeof id !== "string") continue;
      recordedById.set(id, {
        next_review_on: typeof next_review_on === "string" ? next_review_on : null,
      });
    }
  }

  const results = ids.map((id) => {
    const grade = gradeById.get(id)!;
    const recorded = recordedById.get(id);
    const fact = factById.get(id)!;
    return {
      id,
      title: fact.title,
      verdict: grade.verdict,
      quality: grade.quality,
      explanation: grade.explanation,
      next_review_on: recorded ? recorded.next_review_on : fact.next_review_on,
      recorded: Boolean(recorded),
    };
  });

  return jsonResponse({ results });
};
