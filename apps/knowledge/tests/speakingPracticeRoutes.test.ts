import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/speaking-practice.ts";
import { onRequest as startPractice } from "../functions/api/speaking-practice/start.ts";

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
    content: [{ type: "tool_use", name: "submit_speaking_prompts", input: { items } }],
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
    assert.match(String(aiBody?.system), /ビジネス例文/);
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
