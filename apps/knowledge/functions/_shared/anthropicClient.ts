export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
}

/** 出題も採点も問題文と講評の質が成果物そのものなので、軽量モデルには落とさない。 */
export const QUIZ_MODEL = "claude-sonnet-5";

/** Sonnet 5は思考トークンもmax_tokensに含まれる。15問分を切らせないための余裕。 */
export const QUIZ_MAX_TOKENS = 16_000;

export type AnthropicToolCallResult =
  | { ok: true; input: unknown }
  | {
    ok: false;
    status: number;
    error: string;
    action?: string;
    reference?: string;
    /** 接続や認証ではなく、応答が上限トークン数で切れたことを表す。処理段階の表示に使う。 */
    truncated?: true;
  };

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

function providerFailure(status: number): { error: string; action: string } {
  if (status === 400) return {
    error: "AI APIがリクエストを受理できませんでした（HTTP 400）。",
    action: "モデル名、出力形式、送信サイズを確認してください。",
  };
  if (status === 401) return {
    error: "AI APIの認証に失敗しました（HTTP 401）。",
    action: "サーバーに設定したAPIキーが有効か確認してください。",
  };
  if (status === 403) return {
    error: "AI APIを利用する権限がありません（HTTP 403）。",
    action: "APIキーの権限と利用対象モデルを確認してください。",
  };
  if (status === 404) return {
    error: "出題に使用するAIモデルが見つからないか、利用できません（HTTP 404）。",
    action: "設定したモデル名と、アカウントで利用可能なモデルを確認してください。",
  };
  if (status === 413) return {
    error: "AIへ送る出題データが大きすぎます（HTTP 413）。",
    action: "問題数を減らして、もう一度出題してください。",
  };
  if (status === 429) return {
    error: "AI APIの利用上限または短時間のリクエスト上限に達しました（HTTP 429）。",
    action: "少し待ってから再実行し、続く場合はAPIの利用枠を確認してください。",
  };
  if (status === 500 || status === 502 || status === 503 || status === 529) return {
    error: `AIサービスで一時的な障害が発生しています（HTTP ${status}）。`,
    action: "少し待ってから、もう一度出題してください。",
  };
  return {
    error: `AIから応答を取得できませんでした（HTTP ${status}）。`,
    action: "時間を置いて再実行し、続く場合はサーバーログを確認してください。",
  };
}

/**
 * Claude APIを1回呼び出し、強制ツール呼び出しでJSONを取得する。
 * 自由記述の応答を正規表現でパースするより確実なため、出題・採点とも
 * tool_choiceで単一ツールの呼び出しを強制する。
 */
export async function callAnthropicTool(
  env: AnthropicEnv,
  options: {
    model: string;
    system: string;
    userText: string;
    tool: { name: string; description: string; input_schema: Record<string, unknown> };
    maxTokens: number;
  },
): Promise<AnthropicToolCallResult> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: "サーバーのAI接続設定が未完了です。",
      action: "サーバーのANTHROPIC_API_KEYを設定してください。",
    };
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: options.userText }],
        tools: [{
          name: options.tool.name,
          description: options.tool.description,
          input_schema: options.tool.input_schema,
        }],
        tool_choice: { type: "tool", name: options.tool.name },
      }),
    });
  } catch (error) {
    console.error("Anthropic API request failed", error instanceof Error ? error.message : "unknown error");
    return {
      ok: false,
      status: 502,
      error: "AI APIへ接続できませんでした。",
      action: "ネットワーク状態を確認して、もう一度出題してください。",
    };
  }

  if (!response.ok) {
    const reference = response.headers.get("request-id")
      ?? response.headers.get("x-request-id")
      ?? undefined;
    console.error(
      `Anthropic API request failed with status ${response.status}`,
      reference ? `request-id=${reference}` : "request-id=unavailable",
    );
    return {
      ok: false,
      status: 502,
      ...providerFailure(response.status),
      reference,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, error: "AIの応答を読み取れませんでした。" };
  }

  // max_tokensで打ち切られると未完成のJSONは捨てられ、tool_useのinputが空で返る。
  // 呼び出し側から見ると「配列が無い」としか分からないため、打ち切り自体をここで報告する。
  const stopReason = (body as { stop_reason?: unknown })?.stop_reason;
  if (stopReason === "max_tokens") {
    console.error(
      "Anthropic API response truncated by max_tokens",
      `model=${options.model} max_tokens=${options.maxTokens}`,
    );
    return {
      ok: false,
      status: 502,
      error: `AIの応答が上限トークン数（${options.maxTokens}）に達し、途中で打ち切られました。`,
      action: "件数を減らして、もう一度実行してください。",
      truncated: true,
    };
  }

  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return { ok: false, status: 502, error: "AIの応答形式が正しくありません。" };
  }
  const toolUse = content.find(
    (block): block is { type: "tool_use"; input: unknown } =>
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "tool_use"
      && (block as { name?: unknown }).name === options.tool.name,
  );
  if (!toolUse) {
    // stop_reasonは原因の切り分け（安全側の停止か、単なる生成失敗か）に効くので画面まで返す。
    const reported = typeof stopReason === "string" ? stopReason : "不明";
    console.error("Anthropic API returned no tool_use block", `stop_reason=${reported}`);
    return {
      ok: false,
      status: 502,
      error: `AIがツール呼び出しを返しませんでした（stop_reason: ${reported}）。`,
    };
  }
  return { ok: true, input: toolUse.input };
}
