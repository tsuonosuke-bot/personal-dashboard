import {
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
  validateGradeRequest,
  validateQuizRequest,
  type GradeAnswerInput,
} from "../../_shared/quizValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & AnthropicEnv;
}

/** チャットのknowledge-quizスキルと同じ値を使い、履歴が形式で分断されないようにする。 */
const QUIZ_FORMAT = "一問一答";

interface KnowledgeFact {
  id: string;
  title: string;
  explanation: string | null;
  category: string;
  tags: string[];
  next_review_on: string | null;
}

function isKnowledgeFact(value: unknown): value is KnowledgeFact {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string"
    && (record.explanation === null || typeof record.explanation === "string")
    && typeof record.category === "string"
    && Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string")
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

const SYSTEM_PROMPT = `あなたはナレッジDBの復習クイズの採点者です。各項目について、実際に出題した
問題文(question)・正解（タイトルと説明）・ユーザーの回答を照合し、q値(0〜5)を判定してください。

## q値の基準

| q | 状態 |
| --- | --- |
| 5 | 即答・完璧 |
| 4 | 正解だが詰めが甘い |
| 3 | 正解だが苦戦した |
| 2 | 部分正解 |
| 1 | かすった程度 |
| 0 | 全く思い出せない |

## 判定の指針

- 採点するのは question で問われたことに答えられているかどうか。ナレッジ全体を説明できたかでは
  採点しない。空所補充や一問一答で答えの語句が合っていれば、意味やニュアンスの説明がなくても5。
  question が問うていない範囲を減点理由にしない（補足として説明を添えるのは構わない）。
- 表現が違っても意味が合っていれば正解とする。語句の完全一致は求めない。大文字小文字や送り仮名、
  冠詞の有無のような表記の揺れだけで減点しない。
- 核心を外していれば、部分的に合っていても2以下。
- 無回答、「わからない」「忘れた」は0。
- question が空のときだけ、タイトルと説明の核心を問われたものとみなして採点する。

## 各フィールドの書き方

- **correct_answer**: question に対する模範解答を1〜2文で。タイトルをそのまま返すのではなく、
  問われたことへの答えとして書く。
- **explanation**: 2〜4文。正解の要点と、ユーザーの回答のどこが良くてどこが足りなかったかを
  具体的に指摘する。一般論ではなく、目の前のこの回答に対する講評を書く。question に答えられて
  いるなら、まずそれを認めた上で補足する。覚え方や区別のコツがあれば添える。
- **note**: ユーザーが実際に何と答え、どこでつまずいたかを1〜2文で具体的に。次回の出題時に
  参照されるため、「不正解だった」のような抽象的な記述は役に立たない。

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
      select: "id,title,explanation,category,tags,next_review_on",
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
      question: a.question,
      title: fact.title,
      explanation: fact.explanation ?? "",
      category: fact.category,
      tags: fact.tags,
      user_answer: a.answer,
    };
  }));

  const graded = await callAnthropicTool(context.env, {
    model: QUIZ_MODEL,
    system: SYSTEM_PROMPT,
    userText,
    maxTokens: QUIZ_MAX_TOKENS,
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
                correct_answer: { type: "string" },
                explanation: { type: "string" },
                note: { type: "string" },
              },
              required: ["id", "quality", "correct_answer", "explanation", "note"],
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

  interface Grade {
    id: string;
    quality: number;
    verdict: "正解" | "部分正解" | "不正解";
    correctAnswer: string;
    explanation: string;
    note: string;
  }
  const gradeById = new Map<string, Grade>();
  for (const entry of grades) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, quality, correct_answer, explanation, note } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !factById.has(id)) continue;
    if (typeof quality !== "number" || !Number.isInteger(quality) || quality < 0 || quality > 5) continue;
    if (typeof correct_answer !== "string" || typeof explanation !== "string" || typeof note !== "string") continue;
    gradeById.set(id, {
      id,
      quality,
      verdict: verdictForQuality(quality),
      correctAnswer: correct_answer,
      explanation,
      note: note.slice(0, 2_000),
    });
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
      correct_answer: grade.correctAnswer,
      explanation: grade.explanation,
      next_review_on: recorded ? recorded.next_review_on : fact.next_review_on,
      recorded: Boolean(recorded),
    };
  });

  return jsonResponse({ results });
};
