import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../../hub/functions/knowledge/api/speaking-practice.ts";
import { onRequest as startPractice } from "../../hub/functions/knowledge/api/speaking-practice/start.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
  ANTHROPIC_API_KEY: "anthropic-test-key",
};

const input = {
  attempt_id: "123e4567-e89b-42d3-a456-426614174001",
  session_id: "123e4567-e89b-42d3-a456-426614174002",
  knowledge_id: "123e4567-e89b-42d3-a456-426614174000",
  practice_type: "instant_composition",
  rating: "smooth",
  answer_text: "Would you mind doing the review?",
  repetitions: 1,
};

const SECOND_ID = "223e4567-e89b-42d3-a456-426614174000";

function startRequest(body: unknown) {
  return new Request("https://dashboard.example/api/speaking-practice/start", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "speaking-practice",
    },
    body: JSON.stringify(body),
  });
}

function anthropicResponse(items: unknown[]) {
  return Response.json({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ items }) }],
  });
}

function sourceRow(id: string, title: string) {
  return {
    id,
    title,
    explanation: "丁寧に依頼するときに使う。",
    category: "英語",
    tags: ["英会話", "フレーズ"],
    archived: false,
  };
}

const firstPrompt = {
  knowledge_id: input.knowledge_id,
  practice_type: "instant_composition",
  prompt_ja: "会議資料を確認していただけますか。",
  target_en: "Would you mind reviewing the meeting materials?",
};
const secondPrompt = {
  knowledge_id: SECOND_ID,
  practice_type: "read_aloud",
  prompt_ja: "できるだけ早く更新をご連絡ください。",
  target_en: "Please share the update at your earliest convenience.",
};

test("再生成が通信失敗しても初回の有効な例文を残し、不足分だけを再依頼する", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[][] = [];
  globalThis.fetch = async (request, init) => {
    if (String(request).includes("/rest/v1/knowledge")) return Response.json([
      sourceRow(input.knowledge_id, "Would you mind doing"), sourceRow(SECOND_ID, "at your earliest convenience"),
    ]);
    const body = JSON.parse(String(init?.body));
    requested.push(JSON.parse(body.messages[0].content).map((item: { id: string }) => item.id));
    return requested.length === 1 ? anthropicResponse([firstPrompt])
      : Response.json({ error: { type: "overloaded_error", message: "busy" } }, { status: 503 });
  };
  try {
    const response = await startPractice({ request: startRequest({ knowledge_ids: [input.knowledge_id, SECOND_ID], mode: "mixed" }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [firstPrompt], partial: true, requested_count: 2, missing_knowledge_ids: [SECOND_ID] });
    assert.deepEqual(requested, [[input.knowledge_id, SECOND_ID], [SECOND_ID]]);
  } finally { globalThis.fetch = originalFetch; }
});

test("再生成の余分な出力は有効な例文を上書きせず、重複した不足分は採用しない", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    if (String(request).includes("/rest/v1/knowledge")) return Response.json([
      sourceRow(input.knowledge_id, "Would you mind doing"), sourceRow(SECOND_ID, "at your earliest convenience"),
    ]);
    return anthropicResponse(++calls === 1 ? [firstPrompt] : [
      { ...firstPrompt, target_en: "Would you mind changing the valid example?" }, secondPrompt, secondPrompt,
    ]);
  };
  try {
    const response = await startPractice({ request: startRequest({ knowledge_ids: [input.knowledge_id, SECOND_ID], mode: "mixed" }), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, [firstPrompt]);
    assert.deepEqual(body.missing_knowledge_ids, [SECOND_ID]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("不足分の再生成が成功したら初回分と元の順で合わせる", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    if (String(request).includes("/rest/v1/knowledge")) return Response.json([
      sourceRow(input.knowledge_id, "Would you mind doing"), sourceRow(SECOND_ID, "at your earliest convenience"),
    ]);
    return anthropicResponse(++calls === 1 ? [firstPrompt] : [secondPrompt]);
  };
  try {
    const response = await startPractice({ request: startRequest({ knowledge_ids: [input.knowledge_id, SECOND_ID], mode: "mixed" }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [firstPrompt, secondPrompt] });
  } finally { globalThis.fetch = originalFetch; }
});

test("不足分だけのリクエストでも最初の音読割り当てを保つ", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    if (String(request).includes("/rest/v1/knowledge")) return Response.json([sourceRow(SECOND_ID, "at your earliest convenience")]);
    const body = JSON.parse(String(init?.body));
    assert.equal(JSON.parse(body.messages[0].content)[0].practice_type, "read_aloud");
    return anthropicResponse([secondPrompt]);
  };
  try {
    const response = await startPractice({ request: startRequest({ knowledge_ids: [SECOND_ID], mode: "mixed", practice_types: { [SECOND_ID]: "read_aloud" } }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [secondPrompt] });
  } finally { globalThis.fetch = originalFetch; }
});

test("不正な再試行の種別指定はデータ取得やAI呼び出しより前に拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Must not fetch"); };
  try {
    for (const practiceTypes of [{}, { [SECOND_ID]: "read_aloud" }, { [input.knowledge_id]: "quiz" }, { [input.knowledge_id]: "read_aloud", [SECOND_ID]: "read_aloud" }]) {
      const response = await startPractice({ request: startRequest({ knowledge_ids: [input.knowledge_id], mode: "mixed", practice_types: practiceTypes }), env });
      assert.equal(response.status, 400);
    }
    const response = await startPractice({ request: startRequest({ knowledge_ids: [input.knowledge_id], mode: "instant_composition", practice_types: { [input.knowledge_id]: "read_aloud" } }), env });
    assert.equal(response.status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test("練習履歴APIは期間と新しい順を固定して取得する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (request) => {
    seenUrl = String(request);
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  };
  try {
    const from = "2026-09-14T00:00:00.000Z";
    const response = await onRequest({
      request: new Request(`https://dashboard.example/api/speaking-practice?from=${encodeURIComponent(from)}&limit=50&offset=0`),
      env,
    });
    assert.equal(response.status, 200);
    assert.match(decodeURIComponent(seenUrl), /practiced_at=gte\.2026-09-14T00:00:00.000Z/);
    assert.match(decodeURIComponent(seenUrl), /order=practiced_at.desc,id.desc/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("練習記録APIは検証済みの値だけを冪等RPCへ渡す", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_request, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json([{ id: 1, ...input, practiced_at: "2026-09-21T00:00:00.000Z" }]);
  };
  try {
    const response = await onRequest({
      request: new Request("https://dashboard.example/api/speaking-practice", {
        method: "POST",
        headers: {
          Origin: "https://dashboard.example",
          "Content-Type": "application/json",
          "X-Dashboard-Action": "speaking-practice",
        },
        body: JSON.stringify(input),
      }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(body?.p_attempt_id, input.attempt_id);
    assert.equal(body?.p_knowledge_id, input.knowledge_id);
    assert.equal(body?.p_practice_type, "instant_composition");
    assert.equal(body?.p_answer_text, input.answer_text);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("練習記録APIは送信元、種別、回数を検証する", async () => {
  const missingOrigin = await onRequest({
    request: new Request("https://dashboard.example/api/speaking-practice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dashboard-Action": "speaking-practice" },
      body: JSON.stringify(input),
    }),
    env,
  });
  assert.equal(missingOrigin.status, 403);

  const invalid = await onRequest({
    request: new Request("https://dashboard.example/api/speaking-practice", {
      method: "POST",
      headers: {
        Origin: "https://dashboard.example",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "speaking-practice",
      },
      body: JSON.stringify({ ...input, practice_type: "quiz", repetitions: 0 }),
    }),
    env,
  });
  assert.equal(invalid.status, 400);
});

test("英会話開始APIはナレッジの表記ではなくAI生成のビジネス例文を返す", async () => {
  const originalFetch = globalThis.fetch;
  let aiBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([
        sourceRow(input.knowledge_id, "Would you mind doing"),
        sourceRow(SECOND_ID, "at your earliest convenience"),
      ]);
    }
    if (url.includes("api.anthropic.com")) {
      aiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return anthropicResponse([
        {
          knowledge_id: input.knowledge_id,
          practice_type: "instant_composition",
          prompt_ja: "会議資料を確認していただけますか。",
          target_en: "Would you mind reviewing the meeting materials?",
        },
        {
          knowledge_id: SECOND_ID,
          practice_type: "read_aloud",
          prompt_ja: "できるだけ早く更新をご連絡ください。",
          target_en: "Please share the update at your earliest convenience.",
        },
      ]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await startPractice({
      request: startRequest({ knowledge_ids: [input.knowledge_id, SECOND_ID], mode: "mixed" }),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0].target_en, "Would you mind reviewing the meeting materials?");
    assert.notEqual(body.items[0].target_en, "Would you mind doing");
    assert.equal(body.items[1].practice_type, "read_aloud");
    // 作り直しは直後に同じsystemで送るので、systemを5分キャッシュする。短い例文なので思考はlow。
    const system = aiBody?.system as { text: string; cache_control?: unknown }[];
    assert.match(system.map((block) => block.text).join(""), /ビジネス例文/);
    assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
    assert.equal((aiBody?.output_config as { effort?: string }).effort, "low");
    assert.match(JSON.stringify(aiBody?.messages), /Would you mind doing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("英会話開始APIは元表記のままや英字入り日本語を再生成する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const title = "Would you mind doing";
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("/rest/v1/knowledge")) return Response.json([sourceRow(input.knowledge_id, title)]);
    if (url.includes("api.anthropic.com")) {
      calls += 1;
      return anthropicResponse([calls === 1 ? {
        knowledge_id: input.knowledge_id,
        practice_type: "instant_composition",
        prompt_ja: "Would you mind を使って依頼してください。",
        target_en: title,
      } : {
        knowledge_id: input.knowledge_id,
        practice_type: "instant_composition",
        prompt_ja: "この報告書を今日中に確認していただけますか。",
        target_en: "Would you mind reviewing this report today?",
      }]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await startPractice({
      request: startRequest({ knowledge_ids: [input.knowledge_id], mode: "instant_composition" }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    const body = await response.json() as { items: Array<{ target_en: string }> };
    assert.equal(body.items[0].target_en, "Would you mind reviewing this report today?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("英会話開始APIはAI再生成後も条件不適合なら元表記に戻さず失敗させる", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("/rest/v1/knowledge")) {
      return Response.json([sourceRow(input.knowledge_id, "Would you mind doing")]);
    }
    if (url.includes("api.anthropic.com")) return anthropicResponse([{
      knowledge_id: input.knowledge_id,
      practice_type: "read_aloud",
      prompt_ja: "丁寧な依頼です。",
      target_en: "Would you mind doing",
    }]);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await startPractice({
      request: startRequest({ knowledge_ids: [input.knowledge_id], mode: "read_aloud" }),
      env,
    });
    assert.equal(response.status, 502);
    const body = await response.json() as { stage: string; details: string[] };
    assert.equal(body.stage, "AI応答の確認");
    assert.match(body.details[0], /ナレッジの表記そのまま/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("英会話開始APIはIDの重複と対象外ナレッジを拒否する", async () => {
  const duplicate = await startPractice({
    request: startRequest({ knowledge_ids: [input.knowledge_id, input.knowledge_id], mode: "mixed" }),
    env,
  });
  assert.equal(duplicate.status, 400);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    ...sourceRow(input.knowledge_id, "丁寧な依頼"),
    category: "ビジネス",
    tags: [],
  }]);
  try {
    const response = await startPractice({
      request: startRequest({ knowledge_ids: [input.knowledge_id], mode: "mixed" }),
      env,
    });
    assert.equal(response.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
