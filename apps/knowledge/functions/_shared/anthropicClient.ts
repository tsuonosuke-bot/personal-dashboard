export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
}

/** 出題も採点も問題文と講評の質が成果物そのものなので、軽量モデルには落とさない。 */
export const QUIZ_MODEL = "claude-sonnet-5-5";

/** Sonnet 5.5は思考トークンもmax_tokensに含まれる。30問分を切らせないための余裕。 */
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

/** 構造化出力が受け付けない制約。出力側の件数・範囲は呼び出し側がDB記録前に検証している。 */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems",
]);

/**
 * JSONスキーマを構造化出力で使える形にする。オブジェクトには additionalProperties: false を付け、
 * 数値・文字数の範囲、maxItems、2以上のminItemsを外す（外した制約は受け取った後に検証する）。
 */
export function toStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStructuredOutputSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    if (key === "properties" && typeof value === "object" && value !== null) {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, toStructuredOutputSchema(child)]),
      );
      continue;
    }
    result[key] = key === "items" || key === "anyOf" || key === "allOf" ? toStructuredOutputSchema(value) : value;
  }
  if (result.type === "object") result.additionalProperties = false;
  return result;
}

/**
 * Claude APIを1回呼び出し、構造化出力（output_config.format）でスキーマどおりのJSONを受け取る。
 * 自由記述の応答を正規表現でパースするより確実なため、出題・採点ともこの形にする。
 * Sonnet 5.5は強制ツール呼び出し（tool_choiceのtool/any）を受け付けないため、ツールは使わない。
 * tool.input_schema をそのまま出力スキーマとして使い、戻り値の input は旧来のツール入力と同じ形になる。
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
        output_config: {
          format: { type: "json_schema", schema: toStructuredOutputSchema(options.tool.input_schema) },
        },
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

  if (stopReason === "refusal") {
    const category = (body as { stop_details?: { category?: unknown } })?.stop_details?.category;
    console.error("Anthropic API refused the request", `category=${typeof category === "string" ? category : "unknown"}`);
    return {
      ok: false,
      status: 502,
      error: "AIが安全上の理由で応答を控えました（stop_reason: refusal）。",
      action: "対象の内容を確認して、もう一度実行してください。",
    };
  }

  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return { ok: false, status: 502, error: "AIの応答形式が正しくありません。" };
  }
  // 思考ブロックの後に、スキーマどおりのJSONがtextブロックで返る。
  const text = content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) {
    // stop_reasonは原因の切り分け（安全側の停止か、単なる生成失敗か）に効くので画面まで返す。
    const reported = typeof stopReason === "string" ? stopReason : "不明";
    console.error("Anthropic API returned no JSON text", `stop_reason=${reported}`);
    return {
      ok: false,
      status: 502,
      error: `AIがJSONの応答を返しませんでした（stop_reason: ${reported}）。`,
    };
  }
  try {
    return { ok: true, input: JSON.parse(text) as unknown };
  } catch {
    console.error("Anthropic API returned text that is not JSON", `length=${text.length}`);
    return { ok: false, status: 502, error: "AIの応答をJSONとして読み取れませんでした。" };
  }
}
