import assert from "node:assert/strict";
import test from "node:test";
import { gradeAnswers, type GradingAnswer } from "../functions/_shared/answerGrading.ts";
import {
  allowedFormats,
  generateQuestions,
  generationIssue,
  type PickedItem,
} from "../functions/_shared/questionGeneration.ts";

const env = { ANTHROPIC_API_KEY: "test-key" };

/** 構造化出力の応答。思考ブロックの後に、スキーマどおりのJSONがtextブロックで返る。 */
function aiJson(value: unknown, stopReason = "end_turn") {
  return Response.json({ stop_reason: stopReason, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(value) }] });
}

/** Anthropic APIへの呼び出しを順番に記録し、用意した応答を返す。 */
async function withAi(responses: ((body: Record<string, unknown>) => Response)[], run: (bodies: Record<string, unknown>[]) => Promise<void>) {
  const bodies: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const next = responses[bodies.length - 1];
    if (!next) throw new Error("unexpected AI call");
    return next(body);
  };
  try {
    await run(bodies);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function item(id: string, title: string, overrides: Partial<PickedItem> = {}): PickedItem {
  return {
    id, title, explanation: `${title}の説明`, category: "ビジネス", mastery: "学習中", times_asked: 2,
    pool: "A", stability_hours: 48, relearning_stage: null, ...overrides,
  };
}

const sentItems = (body: Record<string, unknown>) =>
  JSON.parse(String((body.messages as { content: string }[])[0].content)) as { id: string }[];

test("出題形式は知識の状態で決め、許可されていない形式の問題は採用しない", async () => {
  const relearning = item("a", "選択と集中", { relearning_stage: "recognition" });
  const settled = item("b", "サイロ化", { mastery: "定着" });
  assert.deepEqual(allowedFormats(relearning, "おまかせ"), ["四択"]);
  assert.deepEqual(allowedFormats(settled, "おまかせ"), ["一問一答", "記述説明", "産出"]);

  await withAi([() => aiJson({ questions: [
    { id: "a", question: "強みに資源を集める方針は？", format: "一問一答", expected_answer: "選択と集中" },
  ] })], async () => {
    const result = await generateQuestions(env, [relearning], new Map([["a", ["四択" as const]]]), new Map(), new Map());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.byId.size, 0);
    assert.match(result.issueById.get("a") ?? "", /四択/);
  });
});

test("四択は重複のない4件の選択肢と、その中にある正解がそろって初めて採用する", async () => {
  const card = item("a", "選択と集中", { mastery: "未学習" });
  await withAi([() => aiJson({ questions: [
    { id: "a", question: "Q", format: "四択", choices: ["x", "y", "z"], correct_choice: "x", expected_answer: "x" },
  ] })], async () => {
    const result = await generateQuestions(env, [card], new Map([["a", ["四択" as const]]]), new Map(), new Map());
    assert.ok(result.ok);
    if (result.ok) assert.match(result.issueById.get("a") ?? "", /選択肢が3件/);
  });
  await withAi([() => aiJson({ questions: [
    { id: "a", question: "Q", format: "四択", choices: ["w", "x", "y", "z"], correct_choice: "v", expected_answer: "v" },
  ] })], async () => {
    const result = await generateQuestions(env, [card], new Map([["a", ["四択" as const]]]), new Map(), new Map());
    assert.ok(result.ok);
    if (result.ok) assert.match(result.issueById.get("a") ?? "", /correct_choice/);
  });
});

test("答えのタイトルが漏れた問題と、正解と矛盾する語数指定の問題は採用しない", () => {
  const leaked = generationIssue(item("a", "サイロ化"), {
    question: "サイロ化とは何か？", format: "一問一答", choices: null, correctChoice: null, explanation: null, expectedAnswer: null,
  }, undefined);
  assert.match(leaked ?? "", /title/);
  const english = item("b", "before you knew it", { category: "英語" });
  const wrongCount = generationIssue(english, {
    question: "「いつの間にか」を3語の英語で答えてください。", format: "一問一答", choices: null, correctChoice: null,
    explanation: null, expectedAnswer: null,
  }, undefined);
  assert.match(wrongCount ?? "", /3語.*4語/);
});

test("questions がJSON文字列で返っても受け入れ、配列が無ければ1回だけ作り直す", async () => {
  const card = item("a", "選択と集中");
  const allowed = new Map([["a", ["一問一答" as const]]]);
  await withAi([() => aiJson({ questions: JSON.stringify([{ id: "a", question: "Q", format: "一問一答", expected_answer: "A" }]) })], async () => {
    const result = await generateQuestions(env, [card], allowed, new Map(), new Map());
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.byId.get("a")?.expectedAnswer, "A");
  });
  await withAi([() => aiJson({ items: [] }), () => aiJson({ nothing: true })], async (bodies) => {
    const result = await generateQuestions(env, [card], allowed, new Map(), new Map());
    assert.equal(bodies.length, 2);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.failure.reason, /2回試行.*nothing/);
  });
});

test("上限トークン数での打ち切りは、配列が無いのではなく打ち切りとして報告する", async () => {
  await withAi([() => Response.json({ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"questions\": [" }] })], async () => {
    const result = await generateQuestions(env, [item("a", "x")], new Map([["a", ["一問一答" as const]]]), new Map(), new Map());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.stage, "AI応答の確認");
      assert.match(result.failure.reason, /上限トークン数（16000）/);
    }
  });
});

function answer(key: string, overrides: Partial<GradingAnswer> = {}): GradingAnswer {
  return {
    key,
    fact: { id: key, title: "サイロ化", explanation: "組織が分断される", category: "ビジネス", tags: [], archived: false },
    format: "一問一答",
    question: "部署ごとに分断された状態を何という？",
    choices: null,
    choiceIsCorrect: null,
    answer: "サイロ化",
    ...overrides,
  };
}

test("無回答と「わからない」はAIを呼ばずにq0で採点する", async () => {
  await withAi([], async (bodies) => {
    const result = await gradeAnswers(env, [answer("1", { answer: "" }), answer("2", { answer: "わからない" })]);
    assert.equal(bodies.length, 0);
    assert.equal(result.grades.get("1")?.quality, 0);
    assert.equal(result.grades.get("2")?.verdict, "不正解");
  });
});

test("回答に無い引用を返した採点は捨て、未採点分だけを再採点する", async () => {
  const grade = (id: string, quote: string, quality = 4) => ({
    id, answer_quotes: [quote], quality, correct_answer: "サイロ化", explanation: "講評", note: "メモ",
  });
  await withAi([
    () => aiJson({ grades: [grade("1", "サイロ化"), grade("2", "書いていない語句")] }),
    (body) => {
      assert.deepEqual(sentItems(body).map((entry) => entry.id), ["2"]);
      return aiJson({ grades: [grade("2", "たこつぼ", 3)] });
    },
  ], async (bodies) => {
    const result = await gradeAnswers(env, [answer("1"), answer("2", { answer: "たこつぼ化" })]);
    assert.equal(bodies.length, 2);
    assert.equal(result.grades.get("1")?.quality, 4);
    assert.equal(result.grades.get("2")?.quality, 3);
    assert.equal(result.errors.size, 0);
  });
});

test("一括の再採点でも残った項目は1問ずつ再採点し、それでも駄目な項目だけを失敗にする", async () => {
  const bad = { id: "2", answer_quotes: ["無い語句"], quality: 4, correct_answer: "c", explanation: "e", note: "n" };
  await withAi([
    () => aiJson({ grades: [{ id: "1", answer_quotes: ["サイロ化"], quality: 5, correct_answer: "c", explanation: "e", note: "n" }, bad] }),
    () => aiJson({ grades: [bad] }),
    () => aiJson({ grades: [bad] }),
  ], async (bodies) => {
    const result = await gradeAnswers(env, [answer("1"), answer("2", { answer: "別の答え" })]);
    assert.equal(bodies.length, 3);
    assert.equal(result.grades.get("1")?.quality, 5);
    assert.equal(result.grades.has("2"), false);
    assert.match(result.errors.get("2") ?? "", /有効な採点結果/);
  });
});

test("四択は出題時の正解との照合をAIの評価より優先する", async () => {
  const choiceAnswer = (key: string, correct: boolean): GradingAnswer => answer(key, {
    format: "四択", choices: ["a", "b", "c", "d"], choiceIsCorrect: correct, answer: correct ? "b" : "c",
  });
  await withAi([() => aiJson({ grades: [
    { id: "1", answer_quotes: ["b"], quality: 2, correct_answer: "b", explanation: "e", note: "n" },
    { id: "2", answer_quotes: ["c"], quality: 4, correct_answer: "b", explanation: "e", note: "n" },
  ] })], async () => {
    const result = await gradeAnswers(env, [choiceAnswer("1", true), choiceAnswer("2", false)]);
    assert.equal(result.grades.get("1")?.quality, 4);
    assert.equal(result.grades.get("2")?.quality, 1);
    assert.equal(result.grades.get("2")?.verdict, "不正解");
  });
});

test("設問の誤った語数指定に従った1語差の回答は、知識不足として記録しない", async () => {
  const english = answer("1", {
    fact: { id: "1", title: "before you knew it", explanation: null, category: "英語", tags: [], archived: false },
    question: "「いつの間にか」を3語の英語で答えてください。",
    answer: "before you knew",
  });
  await withAi([() => aiJson({ grades: [
    { id: "1", answer_quotes: ["before you knew"], quality: 2, correct_answer: "before you knew it", explanation: "e", note: "n" },
  ] })], async () => {
    const result = await gradeAnswers(env, [english]);
    assert.equal(result.grades.get("1")?.quality, 4);
    assert.match(result.grades.get("1")?.explanation ?? "", /設問側の指定に誤り/);
  });
});
