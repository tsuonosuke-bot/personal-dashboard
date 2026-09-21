import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as startRoute } from "../functions/api/quiz/start.ts";
import { onRequest as gradeRoute } from "../functions/api/quiz/grade.ts";
import { QUIZ_ACTION_HEADER } from "../functions/_shared/quizValidation.ts";
import { issueQuizToken, type SignedQuizItem } from "../functions/_shared/quizSession.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  ANTHROPIC_API_KEY: "anthropic-test-key",
  QUIZ_SIGNING_SECRET: "quiz-signing-secret-that-is-longer-than-thirty-two-characters",
};

const ID_1 = "123e4567-e89b-42d3-a456-426614174000";
const ID_2 = "223e4567-e89b-42d3-a456-426614174000";
const ID_3 = "323e4567-e89b-42d3-a456-426614174000";

function quizPost(path: string, body: unknown) {
  return new Request(`https://dashboard.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": QUIZ_ACTION_HEADER,
    },
    body: JSON.stringify(body),
  });
}

function anthropicToolResponse(name: string, input: unknown) {
  return Response.json({ content: [{ type: "tool_use", name, input }] });
}

function pickedRow(id: string, category: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `秘密のタイトル ${id.slice(0, 4)}`,
    explanation: "説明",
    category,
    mastery: "学習中",
    times_asked: 3,
    pool: "A",
    stability_hours: 48,
    relearning_stage: null,
    ...overrides,
  };
}

async function signedAnswer(
  item: SignedQuizItem & { correctChoice?: string | null },
  answer: string,
) {
  const request = quizPost("/api/quiz/grade", []);
  const signed = await issueQuizToken({
    ...item,
    correctChoice: item.format === "四択" ? item.correctChoice ?? null : null,
  }, request, env);
  assert.equal(signed.ok, true);
  if (!signed.ok) throw new Error(signed.error);
  return { token: signed.token, answer };
}

test("quiz/start はpick_quizの候補にAI生成の問題文だけを付けて返す（正解は含めない）", async () => {
  const originalFetch = globalThis.fetch;
  let seenModel = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([pickedRow(ID_1, "英語"), pickedRow(ID_2, "歴史")]);
    }
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([{ id: ID_1, tags: ["文法"] }, { id: ID_2, tags: [] }]);
    }
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      seenModel = (JSON.parse(String(init?.body)) as { model: string }).model;
      return anthropicToolResponse("submit_questions", {
        questions: [{ id: ID_1, question: "問題1" }, { id: ID_2, question: "問題2" }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { categories: [], limit: 15 }),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      items: { id: string; question: string; format: string; choices: string[] | null; token: string }[];
      early: boolean;
    };
    assert.deepEqual(
      body.items.map(({ token: _token, ...item }) => item),
      [
        { id: ID_1, question: "問題1", format: "一問一答", choices: null },
        { id: ID_2, question: "問題2", format: "一問一答", choices: null },
      ],
    );
    assert.equal(body.items.every((item) => typeof (item as { token?: unknown }).token === "string"), true);
    assert.equal(JSON.stringify(body).includes("秘密のタイトル"), false);
    assert.equal(body.early, false);
    assert.equal(seenModel, "claude-sonnet-5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は選択カテゴリと問題数をpick_quizへ渡す", async () => {
  const originalFetch = globalThis.fetch;
  let seenPick: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      seenPick = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json([pickedRow(ID_1, "歴史")]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", { questions: [{ id: ID_1, question: "問題1" }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { categories: ["歴史", "地理"], limit: 5 }),
      env,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(seenPick.p_include, ["歴史", "地理"]);
    assert.equal(seenPick.p_exclude, null);
    assert.equal(seenPick.p_limit, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は0件時のカテゴリ絞り込みを引用符付きで問い合わせる", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) return Response.json([]);
    if (url.includes("/rest/v1/knowledge")) {
      seenUrl = url;
      return Response.json([], { headers: { "Content-Range": "*/0" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await startRoute({
      request: quizPost("/api/quiz/start", { categories: ["金融, 会計"] }),
      env,
    });
    const category = new URL(seenUrl).searchParams.get("category");
    assert.equal(category, 'in.("金融, 会計")');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start はカテゴリ・タグ・過去のつまずきメモをAIへ渡す", async () => {
  const originalFetch = globalThis.fetch;
  let seenUserText = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) return Response.json([pickedRow(ID_1, "英語")]);
    if (url.includes("/rest/v1/knowledge")) return Response.json([{ id: ID_1, tags: ["文法"] }]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) {
      return Response.json([
        { knowledge_id: ID_1, quality: 2, verdict: "部分正解", note: "受動態と混同した", asked_on: "2026-09-10" },
        { knowledge_id: ID_1, quality: 1, verdict: "不正解", note: "語順を間違えた", asked_on: "2026-09-01" },
        { knowledge_id: ID_1, quality: 0, verdict: "不正解", note: "3件目は渡さない", asked_on: "2026-08-20" },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      seenUserText = body.messages[0].content;
      return anthropicToolResponse("submit_questions", { questions: [{ id: ID_1, question: "問題1" }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    assert.equal(response.status, 200);
    const sent = JSON.parse(seenUserText) as {
      category: string; tags: string[]; past_notes: { note: string }[];
    }[];
    assert.equal(sent[0].category, "英語");
    assert.deepEqual(sent[0].tags, ["文法"]);
    assert.deepEqual(sent[0].past_notes.map((n) => n.note), ["受動態と混同した", "語順を間違えた"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は同じカテゴリが連続しないよう出題順を入れ替える", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        pickedRow(ID_1, "英語"), pickedRow(ID_2, "英語"), pickedRow(ID_3, "歴史"),
      ]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", {
        questions: [
          { id: ID_1, question: "英語1" }, { id: ID_2, question: "英語2" }, { id: ID_3, question: "歴史" },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    const body = await response.json() as { items: { id: string }[] };
    assert.deepEqual(body.items.map((item) => item.id), [ID_1, ID_3, ID_2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start はカテゴリを散らしても再学習プールRを先に保つ", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        pickedRow(ID_1, "英語", { pool: "R" }),
        pickedRow(ID_2, "英語", { pool: "A" }),
        pickedRow(ID_3, "歴史", { pool: "A" }),
      ]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", {
        questions: [
          { id: ID_1, question: "再学習" }, { id: ID_2, question: "通常1" }, { id: ID_3, question: "通常2" },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    const body = await response.json() as { items: { id: string }[] };
    assert.deepEqual(body.items.map((item) => item.id), [ID_1, ID_3, ID_2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は0件の理由を本日出題済みと対象なしで切り分ける", async () => {
  const originalFetch = globalThis.fetch;
  let knowledgeTotal = "0-0/7";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) return Response.json([]);
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([], { headers: { "Content-Range": knowledgeTotal } });
    }
    if (url.includes("api.anthropic.com")) throw new Error("AIを呼んではいけない");
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const doneToday = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    assert.deepEqual(await doneToday.json(), { items: [], reason: "done_today" });

    knowledgeTotal = "*/0";
    const noKnowledge = await startRoute({ request: quizPost("/api/quiz/start", {}), env });
    assert.deepEqual(await noKnowledge.json(), { items: [], reason: "no_knowledge" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は同一オリジン・専用ヘッダーを要求する", async () => {
  const response = await startRoute({
    request: new Request("https://dashboard.example/api/quiz/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    env,
  });
  assert.equal(response.status, 403);
});

test("quiz/start は段階で形式を絞り、複数候補は知識構造に合わせてAIが選ぶ", async () => {
  const originalFetch = globalThis.fetch;
  let sentItems: { id: string; allowed_formats: string[] }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        pickedRow(ID_1, "ビジネス", { mastery: "未学習" }),
        pickedRow(ID_2, "歴史", { mastery: "習得中" }),
        pickedRow(ID_3, "英語", { mastery: "定着" }),
      ]);
    }
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([{ id: ID_1, tags: [] }, { id: ID_2, tags: [] }, { id: ID_3, tags: [] }]);
    }
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      sentItems = JSON.parse(body.messages[0].content) as { id: string; allowed_formats: string[] }[];
      return anthropicToolResponse("submit_questions", {
        questions: [
          { id: ID_1, question: "問題1", format: "四択", choices: ["ア", "イ", "ウ", "エ"], correct_choice: "ア" },
          { id: ID_2, question: "問題2", format: "記述説明" },
          { id: ID_3, question: "問題3", format: "産出" },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { format: "おまかせ" }),
      env,
    });
    assert.equal(response.status, 200);
    const formatsOf = (id: string) => sentItems.find((item) => item.id === id)?.allowed_formats;
    assert.deepEqual(formatsOf(ID_1), ["四択"]);
    assert.deepEqual(formatsOf(ID_2), ["一問一答", "記述説明"]);
    assert.deepEqual(formatsOf(ID_3), ["産出"]);

    const body = await response.json() as { items: { id: string; choices: string[] | null }[] };
    const choiceItem = body.items.find((item) => item.id === ID_1)!;
    assert.deepEqual([...choiceItem.choices!].sort(), ["ア", "イ", "ウ", "エ"]);
    // 四択以外に選択肢を持たせない。
    assert.equal(body.items.find((item) => item.id === ID_2)!.choices, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は選択肢が崩れた項目だけをもう一度生成し直して救う", async () => {
  const originalFetch = globalThis.fetch;
  let anthropicCalls = 0;
  const retryRequestIds: string[][] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        pickedRow(ID_1, "ビジネス", { mastery: "未学習" }),
        pickedRow(ID_2, "歴史", { mastery: "未学習" }),
      ]);
    }
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([{ id: ID_1, tags: [] }, { id: ID_2, tags: [] }]);
    }
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      anthropicCalls++;
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const sentIds = (JSON.parse(body.messages[0].content) as { id: string }[]).map((i) => i.id);
      if (anthropicCalls === 1) {
        // 1回目はID_1の選択肢が3件しかなく不採用、ID_2は正常。
        return anthropicToolResponse("submit_questions", {
          questions: [
            { id: ID_1, question: "問題1", choices: ["ア", "イ", "ウ"], correct_choice: "ア" },
            { id: ID_2, question: "問題2", choices: ["A", "B", "C", "D"], correct_choice: "A" },
          ],
        });
      }
      // 2回目（再生成）はID_1だけが送られてくるはず。
      retryRequestIds.push(sentIds);
      return anthropicToolResponse("submit_questions", {
        questions: [{
          id: ID_1,
          question: "問題1（再生成）",
          choices: ["カ", "キ", "ク", "ケ"],
          correct_choice: "カ",
        }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { format: "四択" }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal(anthropicCalls, 2);
    assert.deepEqual(retryRequestIds, [[ID_1]]);
    const body = await response.json() as { items: { id: string; question: string; choices: string[] | null }[] };
    const item1 = body.items.find((item) => item.id === ID_1)!;
    const item2 = body.items.find((item) => item.id === ID_2)!;
    assert.equal(item1.question, "問題1（再生成）");
    assert.deepEqual([...item1.choices!].sort(), ["カ", "キ", "ク", "ケ"]);
    assert.deepEqual([...item2.choices!].sort(), ["A", "B", "C", "D"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は正解と矛盾する英語の語数指定を再生成する", async () => {
  const originalFetch = globalThis.fetch;
  let anthropicCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([pickedRow(ID_1, "英語", { title: "before you knew it" })]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([{ id: ID_1, tags: ["熟語"] }]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      anthropicCalls += 1;
      return anthropicToolResponse("submit_questions", {
        questions: [{
          id: ID_1,
          question: anthropicCalls === 1
            ? "『気づいたら』という意味の3語の表現を英語で書いてください。"
            : "『気づいたら』という意味の4語の表現を英語で書いてください。",
        }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { format: "一問一答" }),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: { question: string }[] };
    assert.equal(anthropicCalls, 2);
    assert.match(body.items[0].question, /4語/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は四択の選択肢がそろわなければ自由記述に落とさず失敗させる", async () => {
  const originalFetch = globalThis.fetch;
  let choices: unknown = ["ア", "イ", "ウ"];
  let correctChoice: unknown = "ア";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([pickedRow(ID_1, "ビジネス", { mastery: "未学習" })]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([{ id: ID_1, tags: [] }]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", {
        questions: [{
          id: ID_1,
          question: "問題1",
          choices,
          correct_choice: correctChoice,
        }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    for (const broken of [
      { choices: ["ア", "イ", "ウ"], correct: "ア", reason: /3件/ },
      { choices: ["ア", "ア", "イ", "ウ"], correct: "ア", reason: /重複/ },
      { choices: ["ア", "", "イ", "ウ"], correct: "ア", reason: /空の選択肢/ },
      { choices: ["ア", "イ", "ウ", "エ"], correct: "選択肢外", reason: /一致しません/ },
      { choices: undefined, correct: undefined, reason: /choicesが返されません/ },
    ]) {
      choices = broken.choices;
      correctChoice = broken.correct;
      const response = await startRoute({
        request: quizPost("/api/quiz/start", { format: "四択" }),
        env,
      });
      assert.equal(response.status, 502, JSON.stringify(broken));
      const body = await response.json() as {
        error: string; stage: string; reason: string; action: string; details: string[];
      };
      assert.equal(body.error, "問題生成に失敗しました。");
      assert.equal(body.stage, "AI応答の確認");
      assert.match(body.reason, /再生成後も1問/);
      assert.equal(body.details.length, 1);
      assert.match(body.details[0], broken.reason);
      assert.match(body.action, /もう一度出題/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start はAI APIの失敗原因と問い合わせ用IDを安全に返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([pickedRow(ID_1, "ビジネス")]);
    }
    if (url.includes("/rest/v1/knowledge")) return Response.json([{ id: ID_1, tags: [] }]);
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return Response.json(
        { error: { type: "rate_limit_error", message: "raw provider message" } },
        { status: 429, headers: { "request-id": "req_test_123" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { format: "一問一答" }),
      env,
    });
    assert.equal(response.status, 502);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.error, "問題生成に失敗しました。");
    assert.equal(body.stage, "AIへの接続");
    assert.match(String(body.reason), /利用上限.*HTTP 429/);
    assert.match(String(body.action), /少し待って/);
    assert.equal(body.reference, "req_test_123");
    assert.equal(JSON.stringify(body).includes("raw provider message"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start はDB障害が発生した処理段階を返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json({ message: "raw database message" }, { status: 500 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", {}),
      env,
    });
    assert.equal(response.status, 502);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.error, "問題生成に失敗しました。");
    assert.equal(body.stage, "出題対象の選定");
    assert.equal(body.reason, "DBの処理に失敗しました。");
    assert.match(String(body.action), /DB接続/);
    assert.equal(JSON.stringify(body).includes("raw database message"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は形式を明示されたら全問をその形式で出す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/pick_quiz")) {
      return Response.json([
        pickedRow(ID_1, "ビジネス", { mastery: "未学習" }),
        pickedRow(ID_2, "英語", { mastery: "定着" }),
      ]);
    }
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([{ id: ID_1, tags: [] }, { id: ID_2, tags: [] }]);
    }
    if (url.includes("/rest/v1/rpc/get_recent_quiz_notes")) return Response.json([]);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_questions", {
        questions: [{ id: ID_1, question: "問題1" }, { id: ID_2, question: "問題2" }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await startRoute({
      request: quizPost("/api/quiz/start", { format: "記述説明" }),
      env,
    });
    const body = await response.json() as { items: { format: string }[] };
    assert.deepEqual(body.items.map((item) => item.format), ["記述説明", "記述説明"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/start は許可されていない形式を拒否する", async () => {
  const response = await startRoute({
    request: quizPost("/api/quiz/start", { format: "ソクラテス式" }),
    env,
  });
  assert.equal(response.status, 400);
});

test("quiz/grade は署名済み問題を採点し、四択の上限を適用して一括記録する", async () => {
  const originalFetch = globalThis.fetch;
  const seenBatchBodies: unknown[] = [];
  const seenGradePrompts: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([
          {
            id: ID_1, title: "正解1", priority: "最高", content_version: 7,
            next_review_on: "2026-10-03", next_review_at: "2026-10-03T03:00:00Z",
            stability_hours: 288, relearning_stage: null,
          },
          {
            id: ID_2, title: "正解2", priority: "高", content_version: 9,
            next_review_on: "2026-10-01", next_review_at: "2026-10-01T03:00:00Z",
            stability_hours: 240, relearning_stage: "recall",
          },
        ]);
      }
      return Response.json([
        {
          id: ID_1, title: "正解1", explanation: "説明1", category: "英語", tags: ["文法"],
          next_review_on: "2026-09-20", archived: false,
        },
        {
          id: ID_2, title: "正解2", explanation: "説明2", category: "歴史", tags: [],
          next_review_on: "2026-09-21", archived: false,
        },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      seenGradePrompts.push(String(init?.body));
      return anthropicToolResponse("submit_grades", {
        grades: [
          {
            id: ID_1, quality: 5, answer_quotes: ["完璧な回答"], correct_answer: "模範解答1",
            explanation: "よくできました", note: "完璧に回答した",
          },
          {
            id: ID_2,
            quality: 0,
            answer_quotes: ["正解2"],
            correct_answer: "模範解答2",
            explanation: "選択肢の言葉をなぞっただけなので不正解",
            note: "正解を選んだが誤って不正解判定した",
          },
        ],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      seenBatchBodies.push(JSON.parse(String(init?.body)));
      return Response.json([
        { id: ID_1, next_review_on: "2026-10-03", recorded: true, schedule_updated: true },
        { id: ID_2, next_review_on: "2026-10-01", recorded: true, schedule_updated: true },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [
        await signedAnswer({
          id: ID_1, question: "出題した問題文1", format: "産出", choices: null,
        }, "完璧な回答"),
        await signedAnswer({
          id: ID_2,
          question: "出題した問題文2",
          format: "四択",
          choices: ["正解2", "誤答A", "誤答B", "誤答C"],
          correctChoice: "正解2",
        }, "正解2"),
      ]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { results: unknown[] };
    assert.deepEqual(body.results, [
      {
        id: ID_1, title: "正解1", category: "英語", verdict: "正解", quality: 5, correct_answer: "模範解答1",
        explanation: "よくできました", priority: "最高", content_version: 7,
        next_review_on: "2026-10-03", next_review_at: "2026-10-03T03:00:00Z",
        stability_hours: 288, relearning_stage: null, schedule_updated: true, recorded: true,
      },
      {
        id: ID_2, title: "正解2", category: "歴史", verdict: "正解", quality: 4, correct_answer: "模範解答2",
        explanation: "正しい選択肢「正解2」を選べています。", priority: "高", content_version: 9,
        next_review_on: "2026-10-01", next_review_at: "2026-10-01T03:00:00Z",
        stability_hours: 240, relearning_stage: "recall", schedule_updated: true, recorded: true,
      },
    ]);
    assert.equal(seenBatchBodies.length, 1);
    const batch = seenBatchBodies[0] as {
      p_answers: { id: string; format: string; note: string; attempt_id: string }[];
    };
    assert.equal(batch.p_answers.length, 2);
    assert.equal(batch.p_answers[0].format, "産出");
    assert.equal(batch.p_answers[1].format, "四択");
    assert.equal((batch.p_answers[1] as { quality: number }).quality, 4);
    assert.equal(batch.p_answers[1].note, "「正解2」を選択し、正解した。");
    assert.match(batch.p_answers[0].attempt_id, /^[A-Za-z0-9_-]{20,64}$/);
    assert.notEqual(batch.p_answers[0].attempt_id, batch.p_answers[1].attempt_id);
    // 採点は「この問いに答えられたか」で行うため、出題した問題文をAIに渡す。
    assert.equal(seenGradePrompts.length, 1);
    assert.match(seenGradePrompts[0], /出題した問題文1/);
    assert.match(seenGradePrompts[0], /出題した問題文2/);
    assert.match(seenGradePrompts[0], /正解2/);
    assert.match(seenGradePrompts[0], /choice_is_correct\\\":true/);
    assert.match(seenGradePrompts[0], /同じ語の単数・複数、時制、活用、比較級/);
    assert.match(seenGradePrompts[0], /the least of my ＿＿＿/);
    assert.match(seenGradePrompts[0], /concerns/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は誤った語数指定に従った1語不足を不正解として記録しない", async () => {
  const originalFetch = globalThis.fetch;
  let recordedQuality: number | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([{
          id: ID_1,
          title: "before you knew it",
          priority: "高",
          content_version: 2,
          next_review_on: "2026-09-22",
          next_review_at: "2026-09-22T03:00:00Z",
          stability_hours: 24,
          relearning_stage: null,
        }]);
      }
      return Response.json([{
        id: ID_1,
        title: "before you knew it",
        explanation: "気づいたら、あっという間に",
        category: "英語",
        tags: ["熟語"],
        archived: false,
      }]);
    }
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1,
          quality: 1,
          answer_quotes: ["before you knew"],
          correct_answer: "before you knew it",
          explanation: "itが欠けています。",
          note: "最後のitを忘れた。",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      const body = JSON.parse(String(init?.body)) as { p_answers: { quality: number }[] };
      recordedQuality = body.p_answers[0].quality;
      return Response.json([{ id: ID_1, recorded: true, schedule_updated: true }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1,
        question: "『気づいたら』という意味の3語の表現を英語で書いてください。",
        format: "一問一答",
        choices: null,
      }, "before you knew")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: { verdict: string; quality: number; explanation: string }[];
    };
    assert.equal(recordedQuality, 4);
    assert.equal(body.results[0].verdict, "正解");
    assert.equal(body.results[0].quality, 4);
    assert.match(body.results[0].explanation, /設問側の指定に誤り/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade はDBの原子的な重複判定をそのまま返す", async () => {
  const originalFetch = globalThis.fetch;
  let batchCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([{
          id: ID_1, title: "正解1", priority: "中", content_version: 4,
          next_review_on: "2026-09-20", next_review_at: "2026-09-20T03:00:00Z",
          stability_hours: 72, relearning_stage: null,
        }]);
      }
      return Response.json([
        {
          id: ID_1, title: "正解1", explanation: "説明1", category: "英語", tags: [],
          next_review_on: "2026-09-20", archived: false,
        },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 4, answer_quotes: ["回答"], correct_answer: "模範解答",
          explanation: "OK", note: "note",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      batchCalled = true;
      return Response.json([{
        id: ID_1, next_review_on: "2026-09-20", recorded: false, schedule_updated: false,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "問題", format: "一問一答", choices: null,
      }, "回答")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: {
        recorded: boolean;
        next_review_on: string | null;
        next_review_at: string;
        schedule_updated: boolean;
        priority: string;
        content_version: number;
      }[];
    };
    assert.equal(body.results[0].recorded, false);
    assert.equal(body.results[0].next_review_on, "2026-09-20");
    assert.equal(body.results[0].next_review_at, "2026-09-20T03:00:00Z");
    assert.equal(body.results[0].schedule_updated, false);
    assert.equal(body.results[0].priority, "中");
    assert.equal(body.results[0].content_version, 4);
    assert.equal(batchCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は改ざんされた問題と四択の選択肢外回答を問題単位で拒否する", async () => {
  const signed = await signedAnswer({
    id: ID_1,
    question: "問題",
    format: "四択",
    choices: ["正解", "誤答A", "誤答B", "誤答C"],
    correctChoice: "正解",
  }, "正解");
  // 署名末尾の文字は下位ビットが捨てられ、書き換えても同じバイト列に戻ることがある。
  // 必ず署名バイトが変わる先頭文字を差し替える。
  const [encodedPayload, encodedSignature] = signed.token.split(".");
  const replacement = encodedSignature[0] === "A" ? "B" : "A";
  const tampered = await gradeRoute({
    request: quizPost("/api/quiz/grade", [{
      token: `${encodedPayload}.${replacement}${encodedSignature.slice(1)}`,
      answer: "正解",
    }]),
    env,
  });
  assert.equal(tampered.status, 200);
  assert.deepEqual((await tampered.json() as { results: unknown[]; failures: { index: number; phase: string }[] }), {
    results: [],
    failures: [{
      index: 0, id: null, phase: "verification", error: "クイズトークンが正しくありません。", recorded: false,
    }],
  });

  const offList = await gradeRoute({
    request: quizPost("/api/quiz/grade", [{ ...signed, answer: "提示されていない回答" }]),
    env,
  });
  assert.equal(offList.status, 200);
  const offListBody = await offList.json() as { results: unknown[]; failures: { error: string }[] };
  assert.equal(offListBody.results.length, 0);
  assert.match(offListBody.failures[0].error, /提示された選択肢/);
});

/** 採点3テストで共通の knowledge 応答。1件分の事実と採点後状態を返す。 */
function gradeKnowledgeResponse(url: string) {
  if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
    return Response.json([{
      id: ID_1, title: "There's room for A", priority: "高", content_version: 3,
      next_review_on: "2026-09-27", next_review_at: "2026-09-27T03:00:00Z",
      stability_hours: 144, relearning_stage: null,
    }]);
  }
  return Response.json([{
    id: ID_1, title: "There's room for A", explanation: "Aの余地がある", category: "英語",
    tags: ["前置詞"], archived: false,
  }]);
}

test("quiz/grade は回答に無い引用を返した採点を捨てて再採点させる", async () => {
  const originalFetch = globalThis.fetch;
  const seenGradePrompts: string[] = [];
  let recordedQuality = -1;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) return gradeKnowledgeResponse(url);
    if (url.includes("api.anthropic.com")) {
      seenGradePrompts.push(String(init?.body));
      // 1回目は回答(of)を読まず、正解のforを答えたことにしてしまった採点。
      if (seenGradePrompts.length === 1) {
        return anthropicToolResponse("submit_grades", {
          grades: [{
            id: ID_1, quality: 5, answer_quotes: ["for"], correct_answer: "for が入る",
            explanation: "正しい前置詞forを即答できている。", note: "forを即答した",
          }],
        });
      }
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 0, answer_quotes: ["of"], correct_answer: "for が入る",
          explanation: "of ではなく for が入ります。", note: "ofと誤答した",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      recordedQuality = (JSON.parse(String(init?.body)) as {
        p_answers: { quality: number }[];
      }).p_answers[0].quality;
      return Response.json([{
        id: ID_1, next_review_on: "2026-09-21", recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "There's room ＿＿＿ improvement.", format: "一問一答", choices: null,
      }, "of")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { results: { verdict: string; quality: number }[] };
    assert.equal(seenGradePrompts.length, 2);
    assert.equal(body.results[0].verdict, "不正解");
    assert.equal(body.results[0].quality, 0);
    assert.equal(recordedQuality, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は再採点でも引用が一致しない問題だけを失敗として返す", async () => {
  const originalFetch = globalThis.fetch;
  let batchCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) return gradeKnowledgeResponse(url);
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 5, answer_quotes: ["for"], correct_answer: "for が入る",
          explanation: "forを即答できている。", note: "forを即答した",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      batchCalled = true;
      return Response.json([{
        id: ID_1, next_review_on: null, recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "There's room ＿＿＿ improvement.", format: "一問一答", choices: null,
      }, "of")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: unknown[];
      failures: { index: number; id: string; phase: string; recorded: boolean; error: string }[];
    };
    assert.equal(body.results.length, 0);
    assert.deepEqual(body.failures, [{
      index: 0,
      id: ID_1,
      phase: "grading",
      error: "AIが回答を読み取った有効な採点結果を返しませんでした。",
      recorded: false,
    }]);
    assert.equal(batchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は1問の採点が壊れても正常な問題を保存して部分完了する", async () => {
  const originalFetch = globalThis.fetch;
  let gradeAttempts = 0;
  let recordedIds: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([{
          id: ID_1, title: "正解1", priority: "高", content_version: 4,
          next_review_on: "2026-09-23", next_review_at: "2026-09-23T03:00:00Z",
          stability_hours: 48, relearning_stage: null,
        }]);
      }
      return Response.json([
        { id: ID_1, title: "正解1", explanation: "説明1", category: "英語", tags: [], archived: false },
        { id: ID_2, title: "正解2", explanation: "説明2", category: "技術", tags: [], archived: false },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      gradeAttempts += 1;
      const valid = {
        id: ID_1, quality: 5, answer_quotes: ["回答1"], correct_answer: "正解1",
        explanation: "回答1で正解です。", note: "回答1と答えた。",
      };
      const invalid = {
        id: ID_2, quality: 5, answer_quotes: ["回答にない引用"], correct_answer: "正解2",
        explanation: "誤った引用です。", note: "誤った引用。",
      };
      return anthropicToolResponse("submit_grades", {
        grades: gradeAttempts === 1 ? [valid, invalid] : [invalid],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      const body = JSON.parse(String(init?.body)) as { p_answers: { id: string }[] };
      recordedIds = body.p_answers.map((answer) => answer.id);
      return Response.json([{ id: ID_1, recorded: true, schedule_updated: true }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [
        await signedAnswer({ id: ID_1, question: "問題1", format: "一問一答", choices: null }, "回答1"),
        await signedAnswer({ id: ID_2, question: "問題2", format: "一問一答", choices: null }, "回答2"),
      ]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: { id: string }[];
      failures: { index: number; id: string; phase: string; recorded: boolean }[];
    };
    assert.deepEqual(body.results.map((result) => result.id), [ID_1]);
    assert.deepEqual(recordedIds, [ID_1]);
    assert.equal(gradeAttempts, 3);
    assert.deepEqual(body.failures, [{
      index: 1,
      id: ID_2,
      phase: "grading",
      error: "AIが回答を読み取った有効な採点結果を返しませんでした。",
      recorded: false,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は一括DB記録が失敗したら1問ずつ分離して保存する", async () => {
  const originalFetch = globalThis.fetch;
  const rpcBodies: string[][] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([{
          id: ID_1, title: "正解1", priority: "中", content_version: 5,
          next_review_on: "2026-09-24", next_review_at: "2026-09-24T03:00:00Z",
          stability_hours: 72, relearning_stage: null,
        }]);
      }
      return Response.json([
        { id: ID_1, title: "正解1", explanation: "説明1", category: "英語", tags: [], archived: false },
        { id: ID_2, title: "正解2", explanation: "説明2", category: "技術", tags: [], archived: false },
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      return anthropicToolResponse("submit_grades", { grades: [
        {
          id: ID_1, quality: 5, answer_quotes: ["回答1"], correct_answer: "正解1",
          explanation: "正解です。", note: "回答1と答えた。",
        },
        {
          id: ID_2, quality: 4, answer_quotes: ["回答2"], correct_answer: "正解2",
          explanation: "正解です。", note: "回答2と答えた。",
        },
      ] });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      const ids = (JSON.parse(String(init?.body)) as { p_answers: { id: string }[] })
        .p_answers.map((answer) => answer.id);
      rpcBodies.push(ids);
      if (ids.length === 2 || ids[0] === ID_2) return Response.json({ message: "db error" }, { status: 500 });
      return Response.json([{ id: ID_1, recorded: true, schedule_updated: true }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [
        await signedAnswer({ id: ID_1, question: "問題1", format: "一問一答", choices: null }, "回答1"),
        await signedAnswer({ id: ID_2, question: "問題2", format: "一問一答", choices: null }, "回答2"),
      ]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: { id: string }[];
      failures: { index: number; id: string; phase: string; recorded: boolean | null }[];
    };
    assert.deepEqual(rpcBodies, [[ID_1, ID_2], [ID_1], [ID_2]]);
    assert.deepEqual(body.results.map((result) => result.id), [ID_1]);
    assert.deepEqual(body.failures, [{
      index: 1, id: ID_2, phase: "recording", error: "DBの処理に失敗しました。", recorded: null,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は一括再採点で残った項目を1問ずつ再採点して回復する", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let batchCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) return gradeKnowledgeResponse(url);
    if (url.includes("api.anthropic.com")) {
      attempts += 1;
      if (attempts < 3) {
        return anthropicToolResponse("submit_grades", {
          grades: [{
            id: ID_1, quality: 5, answer_quotes: ["for"], correct_answer: "for が入る",
            explanation: "forを即答できている。", note: "forを即答した",
          }],
        });
      }
      const requestBody = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      const items = JSON.parse(requestBody.messages[0].content) as unknown[];
      assert.equal(items.length, 1);
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 0, answer_quotes: ["of"], correct_answer: "for が入る",
          explanation: "of ではなく for が入ります。", note: "ofと誤答した",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      batchCalled = true;
      return Response.json([{
        id: ID_1, next_review_on: "2026-09-21", recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "There's room ＿＿＿ improvement.", format: "一問一答", choices: null,
      }, "of")]),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal(attempts, 3);
    assert.equal(batchCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は無回答をAIの判定に関わらずq0で記録する", async () => {
  const originalFetch = globalThis.fetch;
  let recordedQuality = -1;
  let anthropicCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) return gradeKnowledgeResponse(url);
    if (url.includes("api.anthropic.com")) {
      anthropicCalled = true;
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 5, answer_quotes: [], correct_answer: "for が入る",
          explanation: "完璧です。", note: "即答した",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      recordedQuality = (JSON.parse(String(init?.body)) as {
        p_answers: { quality: number }[];
      }).p_answers[0].quality;
      return Response.json([{
        id: ID_1, next_review_on: "2026-09-21", recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "There's room ＿＿＿ improvement.", format: "一問一答", choices: null,
      }, "")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: { verdict: string; quality: number; explanation: string }[];
    };
    assert.equal(body.results[0].quality, 0);
    assert.equal(body.results[0].verdict, "不正解");
    assert.match(body.results[0].explanation, /空欄/);
    assert.equal(recordedQuality, 0);
    assert.equal(anthropicCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は「わからない」をAIに送らず確実にq0で記録する", async () => {
  const originalFetch = globalThis.fetch;
  let recordedQuality = -1;
  let anthropicCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) return gradeKnowledgeResponse(url);
    if (url.includes("api.anthropic.com")) {
      anthropicCalled = true;
      throw new Error("わからない回答ではAIを呼ばない");
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      recordedQuality = (JSON.parse(String(init?.body)) as {
        p_answers: { quality: number }[];
      }).p_answers[0].quality;
      return Response.json([{
        id: ID_1, next_review_on: "2026-09-21", recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "There's room ＿＿＿ improvement.", format: "一問一答", choices: null,
      }, "わからない")]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      results: { verdict: string; quality: number; correct_answer: string; explanation: string }[];
      failures: unknown[];
    };
    assert.equal(body.results[0].quality, 0);
    assert.equal(body.results[0].verdict, "不正解");
    assert.match(body.results[0].correct_answer, /There's room for A/);
    assert.match(body.results[0].explanation, /わからない/);
    assert.equal(body.failures.length, 0);
    assert.equal(recordedQuality, 0);
    assert.equal(anthropicCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiz/grade は回答に書かれていない表現を根拠にした減点を捨てて再採点させる", async () => {
  const originalFetch = globalThis.fetch;
  const answer = "Input（前工程からの入力）・Process（実施内容）・Output（成果物）の頭文字。";
  let attempts = 0;
  let recordedQuality = -1;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/knowledge") && !url.includes("rpc")) {
      if (new URL(url).searchParams.get("select") === "id,title,priority,content_version,next_review_on,next_review_at,stability_hours,relearning_stage") {
        return Response.json([{
          id: ID_1, title: "1W&1PとIPO", priority: "高", content_version: 2,
          next_review_on: "2026-10-04", next_review_at: "2026-10-04T03:00:00Z",
          stability_hours: 312, relearning_stage: null,
        }]);
      }
      return Response.json([{
        id: ID_1, title: "1W&1PとIPO", explanation: "Input・Process・Outputを定義する",
        category: "ビジネス", tags: [], archived: false,
      }]);
    }
    if (url.includes("api.anthropic.com")) {
      attempts += 1;
      // 1回目は回答に無い「前提作業」を書いたことにして減点した採点。
      if (attempts === 1) {
        return anthropicToolResponse("submit_grades", {
          grades: [{
            id: ID_1, quality: 3, answer_quotes: ["Inputを前提作業"],
            correct_answer: "Input・Process・Outputの頭文字。",
            explanation: "Inputを「前提作業」としているのはやや不正確。",
            note: "Inputの説明が不正確だった",
          }],
        });
      }
      return anthropicToolResponse("submit_grades", {
        grades: [{
          id: ID_1, quality: 5, answer_quotes: ["前工程からの入力", "成果物"],
          correct_answer: "Input・Process・Outputの頭文字。",
          explanation: "3要素をいずれも正しく説明できています。",
          note: "3要素を正しく答えた",
        }],
      });
    }
    if (url.includes("/rest/v1/rpc/record_answers_batch_once")) {
      recordedQuality = (JSON.parse(String(init?.body)) as {
        p_answers: { quality: number }[];
      }).p_answers[0].quality;
      return Response.json([{
        id: ID_1, next_review_on: "2026-10-04", recorded: true, schedule_updated: true,
      }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await gradeRoute({
      request: quizPost("/api/quiz/grade", [await signedAnswer({
        id: ID_1, question: "IPOとは何の頭文字か？", format: "記述説明", choices: null,
      }, answer)]),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { results: { quality: number; explanation: string }[] };
    assert.equal(attempts, 2);
    assert.equal(body.results[0].quality, 5);
    assert.equal(recordedQuality, 5);
    assert.doesNotMatch(body.results[0].explanation, /前提作業/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
