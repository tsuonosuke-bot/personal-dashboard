import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as generateRoute } from "../functions/api/review-batch/generate.ts";
import { onRequest as gradeRoute } from "../functions/api/review-batch/grade.ts";
import { onRequest as answerRoute } from "../functions/api/review-queue/answer.ts";
import { onRequest as discardRoute } from "../functions/api/review-queue/discard.ts";
import { onRequest as holdsRoute } from "../functions/api/review-queue/generation-holds.ts";
import { generationIssue, questionFocus } from "../functions/_shared/questionGeneration.ts";
import { onRequest as pendingRoute } from "../functions/api/review-queue/pending.ts";
import { onRequest as serveRoute } from "../functions/api/review-queue/serve.ts";
import { onRequest as statusRoute } from "../functions/api/review-queue/status.ts";
import { instantGrade } from "../functions/_shared/answerGrading.ts";
import { hasReviewBatchToken } from "../functions/_shared/reviewQueue.ts";

const TOKEN = "t".repeat(40);
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
  ANTHROPIC_API_KEY: "anthropic-key",
  REVIEW_BATCH_TOKEN: TOKEN,
};
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";

type Rpc = { name: string; body: Record<string, unknown> };

/** 構造化出力の応答。思考ブロックの後に、スキーマどおりのJSONがtextブロックで返る。 */
function aiJson(value: unknown) {
  return { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(value) }] };
}

/** Supabase RPC・REST・Anthropic への通信を記録し、用意した応答を返す。 */
async function withServices(
  handlers: {
    rpc: (name: string, body: Record<string, unknown>) => unknown;
    rest?: (url: URL) => unknown;
    ai?: (body: Record<string, unknown>) => unknown;
  },
  run: (calls: { rpc: Rpc[]; ai: Record<string, unknown>[] }) => Promise<void>,
): Promise<void> {
  const calls = { rpc: [] as Rpc[], ai: [] as Record<string, unknown>[] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.hostname === "api.anthropic.com") {
      calls.ai.push(body);
      if (!handlers.ai) throw new Error("AI must not be called");
      return Response.json(handlers.ai(body));
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      calls.rpc.push({ name: rpc[1], body });
      return Response.json(handlers.rpc(rpc[1], body));
    }
    if (handlers.rest) return Response.json(handlers.rest(url));
    throw new Error(`unexpected ${url}`);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function browserRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(`https://dashboard.example${path}`, {
    method,
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "review-queue",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

function cronRequest(path: string): Request {
  return new Request(`https://dashboard.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Review-Batch-Token": TOKEN },
    body: "{}",
  });
}

function status(overrides: Record<string, unknown> = {}) {
  return [{
    ready_total: 10, ready_due: 3, waiting_grading: 0, grading_errors: 0, unconfirmed_results: 0,
    queue_limit: 200, queue_full: false, last_generate_at: null, last_generate_status: null,
    last_generate_added: null, last_generate_note: null, last_grade_at: null, last_grade_status: null,
    ...overrides,
  }];
}

function candidate(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id, title, explanation: `${title}の説明`, category: "ビジネス", tags: [], mastery: "学習中",
    times_asked: 2, pool: "A", stability_hours: 48, relearning_stage: null, content_version: 3, ...overrides,
  };
}

test("定期実行の合言葉は、生成・採点バッチへのPOSTで32文字以上が一致したときだけ通す", () => {
  assert.equal(hasReviewBatchToken(cronRequest("/api/review-batch/generate"), env), true);
  assert.equal(hasReviewBatchToken(cronRequest("/api/review-batch/grade"), env), true);
  assert.equal(hasReviewBatchToken(cronRequest("/api/knowledge"), env), false);
  assert.equal(hasReviewBatchToken(cronRequest("/api/review-batch/generate"), { REVIEW_BATCH_TOKEN: "short" }), false);
  assert.equal(hasReviewBatchToken(new Request("https://dashboard.example/api/review-batch/grade", {
    method: "GET", headers: { "X-Review-Batch-Token": TOKEN },
  }), env), false);
  assert.equal(hasReviewBatchToken(new Request("https://dashboard.example/api/review-batch/grade", {
    method: "POST", headers: { "X-Review-Batch-Token": "x".repeat(40) },
  }), env), false);
});

test("合言葉のない画面以外からのバッチ実行は受け付けない", async () => {
  await withServices({ rpc: () => { throw new Error("must not reach DB"); } }, async () => {
    const response = await generateRoute({
      request: new Request("https://dashboard.example/api/review-batch/generate", { method: "POST", body: "{}" }),
      env,
    });
    assert.equal(response.status, 403);
  });
});

test("キューが上限なら、どんな条件でもAIを呼ばずに生成を見送る", async () => {
  await withServices({
    rpc: (name) => {
      if (name === "begin_review_batch") return 7;
      if (name === "get_review_queue_status") return status({ ready_total: 200, queue_full: true });
      if (name === "finish_review_batch") return null;
      throw new Error(`unexpected rpc ${name}`);
    },
  }, async (calls) => {
    const response = await generateRoute({ request: cronRequest("/api/review-batch/generate"), env });
    const body = await response.json() as { status: string; note: string };
    assert.equal(body.status, "skipped");
    assert.match(body.note, /上限（200件）/);
    assert.equal(calls.ai.length, 0);
    assert.deepEqual(calls.rpc.find((call) => call.name === "begin_review_batch")?.body, {
      p_kind: "generate", p_trigger: "schedule",
    });
  });
});

test("生成対象がなければAIを呼ばない。実行中のバッチがあれば何もしない", async () => {
  await withServices({
    rpc: (name) => {
      if (name === "begin_review_batch") return 8;
      if (name === "get_review_queue_status") return status();
      if (name === "pick_review_generation_candidates") return [];
      if (name === "finish_review_batch") return null;
      throw new Error(`unexpected rpc ${name}`);
    },
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as { status: string };
    assert.equal(body.status, "skipped");
    assert.equal(calls.ai.length, 0);
  });
  await withServices({ rpc: (name) => (name === "begin_review_batch" ? null : []) }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as { status: string };
    assert.equal(body.status, "busy");
    assert.deepEqual(calls.rpc.map((call) => call.name), ["begin_review_batch"]);
  });
});

interface GenerationRecord {
  enqueued: Record<string, unknown>[];
  held: Record<string, unknown>[] | null;
  finished: Record<string, unknown>;
}

function generationRecord(): GenerationRecord {
  return { enqueued: [], held: null, finished: {} };
}

/** 生成バッチのRPCを、指定した候補・キュー状態で応答する。呼び出し内容は record に残す。 */
function generationRpc(
  candidates: Record<string, unknown>[],
  record: GenerationRecord,
  options: { holdFails?: boolean; queueStatus?: Record<string, unknown> } = {},
) {
  return (name: string, body: Record<string, unknown>) => {
    if (name === "begin_review_batch") return 9;
    if (name === "get_review_queue_status") return status({ ready_total: 190, ...options.queueStatus });
    if (name === "pick_review_generation_candidates") {
      // 上限までの残り（10件）より多くは求めない。
      assert.equal(body.p_limit, 10);
      return candidates;
    }
    if (name === "get_recent_quiz_notes") return [];
    if (name === "enqueue_review_questions") {
      record.enqueued.push(...(body.p_items as Record<string, unknown>[]));
      return (body.p_items as unknown[]).length;
    }
    if (name === "hold_review_generation_failures") {
      if (options.holdFails) throw new Error("hold failed");
      record.held = body.p_items as Record<string, unknown>[];
      return record.held.length;
    }
    if (name === "finish_review_batch") {
      record.finished = body;
      return null;
    }
    throw new Error(`unexpected rpc ${name}`);
  };
}

const CHOICE_QUESTION = {
  id: K1, question: "自分のテーマ以外を捨てる経営方針は？", format: "四択",
  choices: ["選択と集中", "多角化", "垂直統合", "水平展開"], correct_choice: "選択と集中",
  explanation: "資源を強みに集める考え方なので選択と集中です。",
};
// 正解の語句をそのまま問題文に書いた問題は採用しない。
const LEAKING_QUESTION = { id: K2, question: "サイロ化とは何か？", format: "一問一答", expected_answer: "部門ごとに情報が閉じること" };
const FIXED_QUESTION = {
  id: K2, question: "部門ごとに情報や仕組みが閉じて連携できなくなる状態を何という？", format: "一問一答", expected_answer: "部門の分断",
};
const LEAK_REASON = "問題文に正解であるtitleの語句がそのまま含まれています。答えを伏せてください。";

/** AIへ送った項目ごとの入力（ユーザーメッセージのJSON）。 */
function aiItems(body: Record<string, unknown>): Record<string, unknown>[] {
  const [message] = body.messages as { content: string }[];
  return JSON.parse(message.content) as Record<string, unknown>[];
}

const twoCandidates = () => [
  candidate(K1, "選択と集中", { mastery: "未学習", times_asked: 0, pool: "B" }),
  candidate(K2, "サイロ化"),
];

test("条件を満たさない問題はその場で1回だけ作り直し、それでもだめなカードは保留する", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc(twoCandidates(), record),
    ai: (body) => aiJson({ questions: aiItems(body).length === 2 ? [CHOICE_QUESTION, LEAKING_QUESTION] : [LEAKING_QUESTION] }),
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; succeeded: number; failed: number; note: string;
    };
    assert.equal(calls.ai.length, 2);
    // 通常の生成のプロンプトには作り直しの指示も前回の問題文も入れない。
    assert.equal(aiItems(calls.ai[0]).some((item) => "previous_attempt" in item), false);
    assert.doesNotMatch(String(calls.ai[0].system), /## 作り直し/);
    // 作り直しは不採用の項目だけを、前回の問題文と理由を添えて送る。
    const retried = aiItems(calls.ai[1]);
    assert.deepEqual(retried.map((item) => item.id), [K2]);
    assert.deepEqual(retried[0].previous_attempt, { question: "サイロ化とは何か？", problem: LEAK_REASON });
    assert.match(String(calls.ai[1].system), /## 作り直し/);

    // AIは応答したので、一部のカードが条件を満たさなくてもバッチは成功扱い。
    assert.equal(body.status, "succeeded");
    assert.equal(body.succeeded, 1);
    assert.equal(body.failed, 1);
    assert.match(body.note, /1件は作り直しても条件を満たさなかったため、時間を置いて再挑戦します/);
    assert.equal(record.finished.p_status, "succeeded");

    assert.equal(record.enqueued.length, 1);
    assert.equal(record.enqueued[0].knowledge_id, K1);
    assert.equal(record.enqueued[0].content_version, 3);
    assert.equal(record.enqueued[0].format, "四択");
    assert.equal(record.enqueued[0].correct_choice, "選択と集中");
    assert.deepEqual([...(record.enqueued[0].choices as string[])].sort(), ["垂直統合", "多角化", "水平展開", "選択と集中"].sort());
    assert.equal(record.enqueued[0].prepared_explanation, "資源を強みに集める考え方なので選択と集中です。");

    // 保留には、カードの版・理由・最後にAIが作った問題文を残す。
    assert.deepEqual(record.held, [{ knowledge_id: K2, content_version: 3, reason: LEAK_REASON, question: "サイロ化とは何か？" }]);
  });
});

test("作り直しで条件を満たした問題はキューに入れ、保留しない", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc(twoCandidates(), record),
    ai: (body) => aiJson({ questions: aiItems(body).length === 2 ? [CHOICE_QUESTION, LEAKING_QUESTION] : [FIXED_QUESTION] }),
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; succeeded: number; failed: number; note: string;
    };
    assert.equal(calls.ai.length, 2);
    assert.equal(body.status, "succeeded");
    assert.equal(body.succeeded, 2);
    assert.equal(body.failed, 0);
    assert.match(body.note, /1件は作り直して採用しました/);
    // キューへは作り直した分もまとめて1回で入れる。
    assert.equal(calls.rpc.filter((call) => call.name === "enqueue_review_questions").length, 1);
    assert.deepEqual(record.enqueued.map((item) => item.knowledge_id), [K1, K2]);
    assert.equal(record.enqueued[1].question, FIXED_QUESTION.question);
    assert.equal(calls.rpc.some((call) => call.name === "hold_review_generation_failures"), false);
  });
});

test("すべて条件を満たした生成では作り直さない", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc([candidate(K1, "選択と集中", { mastery: "未学習", times_asked: 0, pool: "B" })], record),
    ai: () => aiJson({ questions: [CHOICE_QUESTION] }),
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; note: string | null;
    };
    assert.equal(calls.ai.length, 1);
    assert.equal(body.status, "succeeded");
    assert.equal(body.note, null);
    assert.equal(calls.rpc.some((call) => call.name === "hold_review_generation_failures"), false);
  });
});

test("作り直しのAI呼び出しに失敗しても、作れた問題は入れて残りを保留する", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc(twoCandidates(), record),
    ai: (body) => aiItems(body).length === 2
      ? aiJson({ questions: [CHOICE_QUESTION, LEAKING_QUESTION] })
      : { stop_reason: "refusal", stop_details: { category: "other" }, content: [] },
  }, async () => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; succeeded: number; failed: number; note: string;
    };
    assert.equal(body.status, "succeeded");
    assert.equal(body.succeeded, 1);
    assert.equal(body.failed, 1);
    assert.match(body.note, /作り直しのAI呼び出しに失敗しました/);
    // 最初の生成で不採用になった問題文と理由を残す。
    assert.deepEqual(record.held, [{ knowledge_id: K2, content_version: 3, reason: LEAK_REASON, question: "サイロ化とは何か？" }]);
  });
});

test("保留の記録に失敗しても、作れた問題は入れてバッチを終える", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc(twoCandidates(), record, { holdFails: true }),
    ai: (body) => aiJson({ questions: aiItems(body).length === 2 ? [CHOICE_QUESTION, LEAKING_QUESTION] : [LEAKING_QUESTION] }),
  }, async () => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; succeeded: number; note: string;
    };
    assert.equal(body.status, "succeeded");
    assert.equal(body.succeeded, 1);
    assert.match(body.note, /保留の記録にも失敗したため、次のバッチでまた作り直します/);
    assert.equal(record.finished.p_status, "succeeded");
  });
});

test("最初の生成でAIを呼べなければ、作り直さずにバッチを失敗にする", async () => {
  const record = generationRecord();
  await withServices({
    rpc: generationRpc([candidate(K2, "サイロ化")], record),
    ai: () => ({ stop_reason: "refusal", stop_details: { category: "other" }, content: [] }),
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; failed: number;
    };
    assert.equal(calls.ai.length, 1);
    assert.equal(body.status, "failed");
    assert.equal(body.failed, 1);
    assert.equal(record.enqueued.length, 0);
    assert.equal(record.held, null);
  });
});

test("保留中のカードしか残っていなければ、その件数をメモに残して見送る", async () => {
  await withServices({
    rpc: generationRpc([], generationRecord(), { queueStatus: { generation_held: 2 } }),
  }, async (calls) => {
    const body = await (await generateRoute({ request: cronRequest("/api/review-batch/generate"), env })).json() as {
      status: string; note: string;
    };
    assert.equal(calls.ai.length, 0);
    assert.equal(body.status, "skipped");
    assert.match(body.note, /問題を作れず保留中のカードが2件あります/);
  });
});

test("四択はAIを呼ばずに採点し、自由記述はAIで採点して回答時刻の予定で記録する", async () => {
  const recorded: Record<string, unknown>[] = [];
  const begins: Record<string, unknown>[] = [];
  await withServices({
    rpc: (name, body) => {
      if (name === "begin_review_batch") {
        begins.push(body);
        // 採点後の再学習分の生成は、実行中扱いで見送らせる。
        return body.p_kind === "grade" ? 11 : null;
      }
      if (name === "claim_review_answers") {
        return [
          {
            id: 101, knowledge_id: K1, format: "四択", question: "Q1", choices: ["a", "b", "c", "d"],
            correct_choice: "b", prepared_explanation: "bが正解です。", answer_text: "c",
            answered_at: "2026-10-02T00:00:00Z", grade_attempts: 1,
          },
          {
            id: 102, knowledge_id: K2, format: "一問一答", question: "部署ごとに分断された状態を何という？",
            choices: null, correct_choice: null, prepared_explanation: null, answer_text: "たこつぼ化",
            answered_at: "2026-10-02T00:01:00Z", grade_attempts: 1,
          },
        ];
      }
      if (name === "record_review_grade") {
        recorded.push(body);
        return [{ item_id: body.p_item_id, quiz_log_id: 500, recorded: true, status: "graded", next_review_at: "2026-10-03T00:00:00Z" }];
      }
      if (name === "finish_review_batch") return null;
      throw new Error(`unexpected rpc ${name}`);
    },
    rest: () => [
      { id: K1, title: "b", explanation: null, category: "ビジネス", tags: [], archived: false },
      { id: K2, title: "サイロ化", explanation: "組織が分断される", category: "ビジネス", tags: [], archived: false },
    ],
    ai: (body) => {
      const items = JSON.parse(String((body.messages as { content: string }[])[0].content)) as { id: string }[];
      // AIへ渡すのは自由記述の1件だけ。
      assert.deepEqual(items.map((item) => item.id), ["102"]);
      return aiJson({
        grades: [{
          id: "102", answer_quotes: ["たこつぼ化"], quality: 4,
          correct_answer: "サイロ化", explanation: "ほぼ同じ意味の言い換えです。", note: "たこつぼ化と答えた。",
        }],
      });
    },
  }, async (calls) => {
    const body = await (await gradeRoute({ request: cronRequest("/api/review-batch/grade"), env })).json() as {
      status: string; succeeded: number; followUp?: { status: string };
    };
    assert.equal(calls.ai.length, 1);
    assert.equal(body.status, "succeeded");
    assert.equal(body.succeeded, 2);
    const choice = recorded.find((call) => call.p_item_id === 101)!;
    assert.equal(choice.p_quality, 1);
    assert.equal(choice.p_verdict, "不正解");
    assert.equal(choice.p_correct_answer, "b");
    assert.equal(choice.p_explanation, "bが正解です。");
    const free = recorded.find((call) => call.p_item_id === 102)!;
    assert.equal(free.p_quality, 4);
    assert.equal(free.p_explanation, "ほぼ同じ意味の言い換えです。");
    // 誤答があったので、再学習分の生成を続けて試みる。
    assert.deepEqual(begins.map((call) => call.p_trigger), ["schedule", "after_grade"]);
    assert.equal(body.followUp?.status, "busy");
  });
});

test("採点できなかった回答は次のバッチへ戻す", async () => {
  const released: Record<string, unknown>[] = [];
  await withServices({
    rpc: (name, body) => {
      if (name === "begin_review_batch") return 12;
      if (name === "claim_review_answers") {
        return [{
          id: 201, knowledge_id: K2, format: "記述説明", question: "なぜ起きる？", choices: null,
          correct_choice: null, prepared_explanation: null, answer_text: "部署ごとに予算が別だから",
          answered_at: "2026-10-02T00:00:00Z", grade_attempts: 1,
        }];
      }
      if (name === "release_review_answer") {
        released.push(body);
        return "answered";
      }
      if (name === "finish_review_batch") return null;
      throw new Error(`unexpected rpc ${name}`);
    },
    rest: () => [{ id: K2, title: "サイロ化", explanation: null, category: "ビジネス", tags: [], archived: false }],
    ai: () => aiJson({ grades: [] }),
  }, async () => {
    const body = await (await gradeRoute({ request: cronRequest("/api/review-batch/grade"), env })).json() as {
      status: string; failed: number;
    };
    assert.equal(body.status, "failed");
    assert.equal(body.failed, 1);
    assert.equal(released.length, 1);
    assert.equal(released[0].p_item_id, 201);
  });
});

test("四択の回答はその場で記録して結果を返し、自由記述は採点待ちにする", async () => {
  await withServices({
    rpc: (name, body) => {
      if (name === "submit_review_answer") {
        return [{
          id: body.p_item_id, knowledge_id: K1, format: "四択", question: "Q", choices: ["a", "b", "c", "d"],
          correct_choice: "b", prepared_explanation: "bが正解です。", answer_text: "b",
          answered_at: "2026-10-02T00:00:00Z", status: "answered", accepted: true,
        }];
      }
      if (name === "record_review_grade") {
        assert.equal(body.p_quality, 4);
        return [{ item_id: body.p_item_id, quiz_log_id: 900, recorded: true, status: "graded", next_review_at: "2026-10-03T00:00:00Z" }];
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    rest: () => [{ id: K1, title: "b", explanation: null, category: "ビジネス", tags: [], archived: false }],
  }, async (calls) => {
    const response = await answerRoute({ request: browserRequest("/api/review-queue/answer", { id: 5, answer: "b" }), env });
    const body = await response.json() as { status: string; result: { quality: number; explanation: string } };
    assert.equal(body.status, "graded");
    assert.equal(body.result.quality, 4);
    assert.equal(body.result.explanation, "bが正解です。");
    assert.equal(calls.ai.length, 0);
  });

  await withServices({
    rpc: (name, body) => {
      if (name === "submit_review_answer") {
        return [{
          id: body.p_item_id, knowledge_id: K2, format: "一問一答", question: "Q", choices: null,
          correct_choice: null, prepared_explanation: null, answer_text: "たこつぼ化",
          answered_at: "2026-10-02T00:00:00Z", status: "answered", accepted: true,
        }];
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    rest: () => [{ id: K2, title: "サイロ化", explanation: null, category: "ビジネス", tags: [], archived: false }],
  }, async (calls) => {
    const body = await (await answerRoute({ request: browserRequest("/api/review-queue/answer", { id: 6, answer: "たこつぼ化" }), env })).json() as { status: string };
    assert.equal(body.status, "answered");
    assert.equal(calls.rpc.some((call) => call.name === "record_review_grade"), false);
  });
});

test("回答を受け付けられない問題は409、送信元が違えば403", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "already answered" }, { status: 400 });
  try {
    const conflict = await answerRoute({ request: browserRequest("/api/review-queue/answer", { id: 7, answer: "x" }), env });
    assert.equal(conflict.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const forbidden = await answerRoute({
    request: new Request("https://dashboard.example/api/review-queue/answer", {
      method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", "X-Dashboard-Action": "review-queue" },
      body: JSON.stringify({ id: 7, answer: "x" }),
    }),
    env,
  });
  assert.equal(forbidden.status, 403);
});

test("出題は正解の選択肢を返さず、カテゴリ指定がなければ全カテゴリから出す", async () => {
  await withServices({
    rpc: (name, body) => {
      assert.equal(name, "serve_review_queue");
      assert.deepEqual(body, { p_limit: 15, p_categories: null });
      return [{ id: 1, knowledge_id: K1, format: "四択", question: "Q", choices: ["a", "b", "c", "d"], category: "ビジネス", pool: "A" }];
    },
  }, async () => {
    const body = await (await serveRoute({ request: browserRequest("/api/review-queue/serve", {}), env })).json() as {
      items: Record<string, unknown>[];
    };
    assert.equal(body.items.length, 1);
    assert.equal("correct_choice" in body.items[0], false);
    assert.deepEqual(body.items[0].choices, ["a", "b", "c", "d"]);
  });
});

test("キューの状態に上限到達と直近の生成結果を含める", async () => {
  await withServices({
    rpc: () => status({
      ready_total: 200, queue_full: true, last_generate_at: "2026-10-02T00:00:00Z",
      last_generate_status: "skipped", last_generate_added: 0, last_generate_note: "上限",
    }),
  }, async () => {
    const body = await (await statusRoute({ request: new Request("https://dashboard.example/api/review-queue/status"), env })).json() as {
      queue_full: boolean; last_generate: { status: string };
    };
    assert.equal(body.queue_full, true);
    assert.equal(body.last_generate.status, "skipped");
  });
});

test("キューの状態に生成を保留中のカード数を含め、移行前のDBでは0にする", async () => {
  for (const [row, expected] of [[status({ generation_held: 3 }), 3], [status(), 0]] as const) {
    await withServices({ rpc: () => row }, async () => {
      const body = await (await statusRoute({ request: new Request("https://dashboard.example/api/review-queue/status"), env })).json() as {
        generation_held: number;
      };
      assert.equal(body.generation_held, expected);
    });
  }
});

test("問題を作れなかったカードの一覧を返し、DBに失敗したら502にする", async () => {
  const hold = {
    knowledge_id: K2, title: "サイロ化", category: "ビジネス", failure_count: 2, last_reason: LEAK_REASON,
    last_question: "サイロ化とは何か？", last_failed_at: "2026-10-04T00:00:00Z", retry_after: "2026-10-04T06:00:00Z",
  };
  await withServices({
    rpc: (name) => {
      assert.equal(name, "list_review_generation_holds");
      return [hold];
    },
  }, async () => {
    const response = await holdsRoute({ request: new Request("https://dashboard.example/api/review-queue/generation-holds"), env });
    assert.deepEqual(await response.json(), { items: [hold] });
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "missing" }, { status: 404 });
  try {
    const response = await holdsRoute({ request: new Request("https://dashboard.example/api/review-queue/generation-holds"), env });
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const post = await holdsRoute({ request: new Request("https://dashboard.example/api/review-queue/generation-holds", { method: "POST" }), env });
  assert.equal(post.status, 405);
});

test("保留は2時間・6時間・24時間と延び、候補選びは待ち時間中の同じ版のカードを除き、キューに入れば消える", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261004120000_review_generation_holds.sql", import.meta.url), "utf8");
  assert.match(sql, /when coalesce\(p_failure_count, 1\) <= 1 then interval '2 hours'\s+when p_failure_count = 2 then interval '6 hours'\s+else interval '24 hours'/);
  assert.match(sql, /h\.knowledge_id = k\.id and h\.content_version = k\.content_version and h\.retry_after > now\(\)/);
  assert.match(sql, /if v_rows > 0 then\s+delete from public\.review_generation_holds h where h\.knowledge_id = item\.knowledge_id;/);
  // 失敗の後に編集されたカードは記録しない（新しい版はすぐに作り直す）。
  assert.match(sql, /join public\.knowledge k on k\.id = i\.knowledge_id and k\.content_version = i\.content_version/);
  assert.match(sql, /references public\.knowledge\(id\) on delete cascade/);
});

test("即時採点は四択と無回答だけを確定し、それ以外はAIの採点へ回す", () => {
  const fact = { title: "サイロ化", explanation: "組織が分断される" };
  assert.equal(instantGrade({ fact, format: "四択", answer: "b", correctChoice: "b", preparedExplanation: null })?.quality, 4);
  assert.equal(instantGrade({ fact, format: "四択", answer: "a", correctChoice: "b", preparedExplanation: null })?.quality, 1);
  assert.equal(instantGrade({ fact, format: "一問一答", answer: "", correctChoice: null, preparedExplanation: null })?.quality, 0);
  assert.equal(instantGrade({ fact, format: "記述説明", answer: "わからない", correctChoice: null, preparedExplanation: null })?.quality, 0);
  assert.equal(instantGrade({ fact, format: "一問一答", answer: "たこつぼ化", correctChoice: null, preparedExplanation: null }), null);
});

test("定期実行の呼び出し関数は合言葉をVaultから読み、ファイルに書かない", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261002110000_review_batch_trigger.sql", import.meta.url), "utf8");
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /'X-Review-Batch-Token', v_token/);
  assert.match(sql, /timeout_milliseconds := 300000/);
  assert.doesNotMatch(sql, /cron\.schedule/);
});

test("採点待ちの一覧は採点待ち・採点中・採点エラーだけを返し、正解は返さない", async () => {
  await withServices({
    rpc: () => { throw new Error("no rpc"); },
    rest: (url) => {
      assert.equal(url.pathname, "/rest/v1/review_queue");
      assert.equal(url.searchParams.get("status"), "in.(answered,grading,error)");
      assert.doesNotMatch(url.searchParams.get("select") ?? "", /correct_choice/);
      return [{ id: 1, knowledge_id: K1, format: "一問一答", question: "Q", answer_text: "A", answered_at: "2026-10-02T00:00:00Z", status: "error", last_error: "AI failure", grade_attempts: 3 }];
    },
  }, async () => {
    const body = await (await pendingRoute({ request: new Request("https://dashboard.example/api/review-queue/pending"), env })).json() as {
      items: { status: string }[];
    };
    assert.equal(body.items[0].status, "error");
  });
});

test("定期実行は生成を30分ごと、採点を1時間ごとに登録する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261002120000_review_batch_schedule.sql", import.meta.url), "utf8");
  assert.match(sql, /cron\.schedule\('review-generate-questions', '\*\/30 \* \* \* \*', \$job\$select public\.trigger_review_batch\('generate'\)\$job\$\)/);
  const hourly = await readFile(new URL("../supabase/migrations/20261005110000_review_grade_hourly.sql", import.meta.url), "utf8");
  assert.match(hourly, /cron\.schedule\('review-grade-answers', '0 \* \* \* \*', \$job\$select public\.trigger_review_batch\('grade'\)\$job\$\)/);
});

test("学習ログ用に採点記録の問題・回答・講評・確認状態を返す", async () => {
  const source = await readFile(new URL("../functions/api/quiz-log.ts", import.meta.url), "utf8");
  assert.match(source, /question,user_answer,correct_answer,explanation,answered_at,confirmed_at,review_queue_id/);
});

test("想定解が問題文に出ている問題は、タイトルが文章でも採用しない", () => {
  const item = {
    id: K1, title: "すべからくは「当然、しなければならない」と言う意味であり、全てという意味ではない",
    explanation: null, category: "単語", mastery: "学習中", times_asked: 2, pool: "A",
    stability_hours: 48, relearning_stage: null,
  };
  const question = (text: string, expectedAnswer: string | null) => ({
    question: text, format: "一問一答" as const, choices: null, correctChoice: null, explanation: null, expectedAnswer,
  });
  assert.match(
    generationIssue(item, question("「すべからく」は「当然、しなければならない」という意味だが、正しい意味は？", "当然、しなければならない"), undefined) ?? "",
    /想定解/,
  );
  assert.equal(generationIssue(item, question("「すべからく」という言葉の正しい意味は？", "当然、しなければならない"), undefined), null);
  // 長い模範解答（記述説明など）は照合しない
  assert.equal(generationIssue(item, question("なぜ誤用されやすいか説明してください。", "「す".repeat(40)), undefined), null);
});

test("回答の応答に想定解を含め、出題の応答には含めない", async () => {
  await withServices({
    rpc: (name, body) => {
      if (name === "submit_review_answer") {
        return [{
          id: body.p_item_id, knowledge_id: K2, format: "一問一答", question: "Q", choices: null,
          correct_choice: null, prepared_explanation: null, expected_answer: "サイロ化", answer_text: "たこつぼ化",
          answered_at: "2026-10-02T00:00:00Z", status: "answered", accepted: true,
        }];
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    rest: () => [{ id: K2, title: "サイロ化", explanation: null, category: "ビジネス", tags: [], archived: false }],
  }, async () => {
    const body = await (await answerRoute({ request: browserRequest("/api/review-queue/answer", { id: 6, answer: "たこつぼ化" }), env })).json() as {
      status: string; expected_answer: string;
    };
    assert.equal(body.status, "answered");
    assert.equal(body.expected_answer, "サイロ化");
  });
  const serve = await readFile(new URL("../functions/api/review-queue/serve.ts", import.meta.url), "utf8");
  assert.doesNotMatch(serve, /expected_answer|correct_choice:/);
});

test("報告された問題は出題待ちのときだけ取り下げる", async () => {
  await withServices({ rpc: (name, body) => {
    assert.equal(name, "discard_review_question");
    return body.p_item_id === 1 ? "discarded" : null;
  } }, async () => {
    assert.equal((await discardRoute({ request: browserRequest("/api/review-queue/discard", { id: 1 }), env })).status, 200);
    assert.equal((await discardRoute({ request: browserRequest("/api/review-queue/discard", { id: 2 }), env })).status, 409);
    assert.equal((await discardRoute({ request: browserRequest("/api/review-queue/discard", { id: "x" }), env })).status, 400);
  });
});

test("AIへは強制ツール呼び出しではなく構造化出力でスキーマを渡し、受け付けない制約を外す", async () => {
  let request: Record<string, unknown> = {};
  await withServices({
    rpc: (name) => {
      if (name === "begin_review_batch") return 21;
      if (name === "get_review_queue_status") return status();
      if (name === "pick_review_generation_candidates") return [candidate(K1, "選択と集中")];
      if (name === "get_recent_quiz_notes") return [];
      if (name === "enqueue_review_questions") return 0;
      if (name === "finish_review_batch") return null;
      throw new Error(`unexpected rpc ${name}`);
    },
    ai: (body) => {
      request = body;
      return aiJson({ questions: [] });
    },
  }, async () => {
    await generateRoute({ request: cronRequest("/api/review-batch/generate"), env });
  });
  assert.equal(request.model, "claude-sonnet-5-5");
  assert.equal("tool_choice" in request, false);
  assert.equal("tools" in request, false);
  const format = (request.output_config as { format: { type: string; schema: Record<string, unknown> } }).format;
  assert.equal(format.type, "json_schema");
  const text = JSON.stringify(format.schema);
  assert.doesNotMatch(text, /"maxItems"|"minimum"|"maximum"/);
  assert.match(text, /"additionalProperties":false/);
  const item = ((format.schema.properties as Record<string, { items: Record<string, unknown> }>).questions).items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ["id", "question", "format", "expected_answer"]);
});

test("AIの拒否と、JSONでない応答は理由つきで失敗にする", async () => {
  const { callAnthropicTool } = await import("../functions/_shared/anthropicClient.ts");
  const tool = { name: "t", description: "d", input_schema: { type: "object", properties: {} } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] });
    const refused = await callAnthropicTool(env, { model: "m", system: "s", userText: "u", tool, maxTokens: 10 });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error, /refusal/);
    globalThis.fetch = async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] });
    const broken = await callAnthropicTool(env, { model: "m", system: "s", userText: "u", tool, maxTokens: 10 });
    assert.equal(broken.ok, false);
    globalThis.fetch = async () => Response.json(aiJson({ ok: 1 }));
    const parsed = await callAnthropicTool(env, { model: "m", system: "s", userText: "u", tool, maxTokens: 10 });
    assert.deepEqual(parsed, { ok: true, input: { ok: 1 } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("過去のメモは正解でも付くので、直近で初めて外したときだけ弱点を突き、それ以外は本文の知識を問う", () => {
  const note = (verdict: string) => ({ asked_on: "2026-10-01", verdict, note: `${verdict}のメモ` });
  assert.equal(questionFocus([]), "core");
  assert.equal(questionFocus([note("正解")]), "core");
  assert.equal(questionFocus([note("正解"), note("不正解")]), "core");
  assert.equal(questionFocus([note("不正解")]), "weak_point");
  assert.equal(questionFocus([note("部分正解"), note("正解")]), "weak_point");
  // 続けて外しているなら、前回すでに弱点を突いたものとみなして本文へ戻る
  assert.equal(questionFocus([note("不正解"), note("部分正解")]), "core");
});

test("生成AIへは直近2回のメモをそのまま渡し、項目ごとに何を問うかを添える", async () => {
  const record = generationRecord();
  const base = generationRpc(twoCandidates(), record);
  await withServices({
    rpc: (name, body) => {
      if (name !== "get_recent_quiz_notes") return base(name, body);
      assert.equal(body.p_per_item, 2);
      return [
        { knowledge_id: K1, verdict: "正解", note: "核心は答えられたが理由が抜けた", asked_on: "2026-10-02", quality: 4 },
        { knowledge_id: K2, verdict: "不正解", note: "部門と組織を取り違えた", asked_on: "2026-10-03", quality: 1 },
        { knowledge_id: K2, verdict: "正解", note: "正しく答えた", asked_on: "2026-10-01", quality: 5 },
      ];
    },
    ai: () => aiJson({ questions: [CHOICE_QUESTION, FIXED_QUESTION] }),
  }, async (calls) => {
    await generateRoute({ request: cronRequest("/api/review-batch/generate"), env });
    const items = aiItems(calls.ai[0]);
    const byId = new Map(items.map((item) => [item.id, item]));
    assert.equal(byId.get(K1)?.focus, "core");
    assert.equal((byId.get(K1)?.past_notes as unknown[]).length, 1);
    assert.equal(byId.get(K2)?.focus, "weak_point");
    assert.deepEqual((byId.get(K2)?.past_notes as { note: string }[]).map((entry) => entry.note), ["部門と組織を取り違えた", "正しく答えた"]);
    // メモがあるだけで弱点を突けとは指示しない
    const system = String(calls.ai[0].system);
    assert.doesNotMatch(system, /past_notes（前回の回答でどこを外したか）があれば、そこを突く/);
    assert.match(system, /focus が "core": title と explanation に書かれた知識そのものを問う/);
    assert.match(system, /focus が "weak_point": past_notes の先頭（直近の回答）で外した点を突く/);
  });
});
