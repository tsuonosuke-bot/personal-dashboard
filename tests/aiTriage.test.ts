import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as suggestionEndpoint } from "../functions/api/want-suggestions.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-test-key",
  ANTHROPIC_API_KEY: "anthropic-test-key",
  ANTHROPIC_WORKSPACE_ID: "wrkspc_test",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/want-suggestions", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "want-ai-suggest",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    source: "want",
    sourceId: 10,
    content: "AIと思考力について考えたい",
    answers: null,
    original: { content: "AIと思考力について考えたい", status: "active" },
    ...overrides,
  };
}

function aiOutput(overrides: Record<string, unknown> = {}) {
  return {
    summary: "エッセイとして問いを深める案です。",
    needs_clarification: false,
    questions: [],
    suggestions: [{
      intent: "explore",
      destination: "writing",
      title: "AIと思考力について書く",
      detail: "AIが思考を助ける面と弱める面を比較する。",
      cadence: null,
      reason: "答えよりも問いを深める内容だからです。",
    }],
    ...overrides,
  };
}

function claudeResponse(output: Record<string, unknown>, stopReason = "end_turn") {
  return Response.json({
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: stopReason,
  });
}

test("AI整理はWantを再確認し、Structured Outputsで提案だけを取得する", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.hostname === "project.supabase.co") return Response.json([{ id: 10 }]);
    if (url.hostname === "api.anthropic.com") return claudeResponse(aiOutput());
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await suggestionEndpoint({ request: request(body()), env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      summary: "エッセイとして問いを深める案です。",
      needsClarification: false,
      questions: [],
      suggestions: [{
        intent: "explore",
        destination: "writing",
        title: "AIと思考力について書く",
        detail: "AIが思考を助ける面と弱める面を比較する。",
        cadence: null,
        reason: "答えよりも問いを深める内容だからです。",
      }],
    });

    assert.equal(requests.length, 2);
    const wantCheck = requests[0];
    assert.equal(wantCheck.url.pathname, "/rest/v1/wants");
    assert.equal(wantCheck.url.searchParams.get("id"), "eq.10");
    assert.equal((wantCheck.init?.headers as Record<string, string>).apikey, "supabase-test-key");

    const claude = requests[1];
    assert.equal(claude.url.href, "https://api.anthropic.com/v1/messages");
    const claudeHeaders = claude.init?.headers as Record<string, string>;
    assert.equal(claudeHeaders.Authorization, "Bearer anthropic-test-key");
    assert.equal(claudeHeaders["anthropic-version"], "2023-06-01");
    assert.equal(claudeHeaders["anthropic-workspace-id"], "wrkspc_test");
    const claudeBody = JSON.parse(String(claude.init?.body));
    assert.equal(claudeBody.model, "claude-sonnet-5");
    assert.equal(claudeBody.max_tokens, 1_200);
    assert.equal(claudeBody.output_config.format.type, "json_schema");
    assert.equal(claudeBody.output_config.format.schema.additionalProperties, false);
    assert.equal(claudeBody.output_config.format.schema.properties.summary.maxLength, undefined);
    assert.equal(claudeBody.output_config.format.schema.properties.questions.maxItems, undefined);
    assert.equal(claudeBody.output_config.format.schema.properties.suggestions.maxItems, undefined);
    assert.match(claudeBody.system, /Do not create events, issues, database records, or tool calls/);
    assert.match(claudeBody.messages[0].content, /AIと思考力について考えたい/);
    assert.equal(claudeBody.tools, undefined);
    assert.ok(!requests.some(({ url }) => /google|github|knowledge|journal/.test(url.hostname)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI設定がない場合はWantも外部サービスも呼ばない", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch must not be called");
  };
  try {
    const response = await suggestionEndpoint({
      request: request(body()),
      env: { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "AI整理機能のサーバー設定が未完了です。手動で振り分けることはできます。" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("別オリジンや専用ヘッダーのないAI整理依頼を拒否する", async () => {
  const wrongOrigin = await suggestionEndpoint({
    request: request(body(), { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const missingAction = await suggestionEndpoint({
    request: request(body(), { "X-Dashboard-Action": "wrong-action" }),
    env,
  });
  assert.equal(missingAction.status, 403);
});

test("Wantが変わっていればAIへ送信せず409を返す", async () => {
  const originalFetch = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    hosts.push(url.hostname);
    return Response.json([]);
  };
  try {
    const response = await suggestionEndpoint({ request: request(body()), env });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "このWantは別の画面で更新されています。再読み込みしてからやり直してください。" });
    assert.deepEqual(hosts, ["project.supabase.co"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("許可されていない分類と登録先の組み合わせをAIが返しても拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "project.supabase.co") return Response.json([{ id: 10 }]);
    return claudeResponse(aiOutput({
      suggestions: [{
        intent: "act",
        destination: "writing",
        title: "不正な組み合わせ",
        detail: "",
        cadence: null,
        reason: "テスト",
      }],
    }));
  };
  try {
    const response = await suggestionEndpoint({ request: request(body()), env });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "AI整理案を安全に読み取れませんでした。手動で振り分けることはできます。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claudeが安全上の理由で拒否した場合は提案を保存せず通知する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "project.supabase.co") return Response.json([{ id: 10 }]);
    return claudeResponse(aiOutput(), "refusal");
  };
  try {
    const response = await suggestionEndpoint({ request: request(body()), env });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "この内容についてAI整理案を作成できませんでした。手動で振り分けてください。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
