export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
}

/** 出題も採点も問題文と講評の質が成果物そのものなので、軽量モデルには落とさない。 */
export const QUIZ_MODEL = "claude-sonnet-5-5";

/** Sonnet 5.5は思考トークンもmax_tokensに含まれる。30問分を切らせないための余裕。 */
export const QUIZ_MAX_TOKENS = 16_000;

/**
 * 出題・採点の思考の深さ。既定のhighでは思考トークン（出力単価で課金）が嵩むため1段下げる。
 * 問題文・講評の条件は生成後と採点後に機械的に検証しているので、崩れた項目はそこで弾かれる。
 */
export const QUIZ_EFFORT: AnthropicEffort = "medium";

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

export type AnthropicEffort = "low" | "medium" | "high";

/**
 * systemのキャッシュの持ち時間。5分は続けて呼び直す呼び出し向け、1時間は30〜60分おきの定期バッチ向け
 * （書き込みは通常入力の2倍だが、読み出しは1割以下になる）。
 */
export type AnthropicCacheTtl = "5m" | "1h";

export interface AnthropicToolCallOptions {
  model: string;
  /** 配列なら先頭を共通部分としてキャッシュし、残り（作り直しの指示など）をその後ろに付ける。 */
  system: string | readonly string[];
  userText: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens: number;
  /** 思考の深さ。思考トークンは出力単価で課金されるため、用途ごとに必要な深さを指定する。省略時はモデルの既定。 */
  effort?: AnthropicEffort;
  /** 指定したときだけsystemの先頭ブロックをキャッシュする。最小（512トークン）未満なら効かないだけで害はない。 */
  cacheTtl?: AnthropicCacheTtl;
}

type AnthropicFailure = Extract<AnthropicToolCallResult, { ok: false }>;

/** Messages APIへ送る本文。通常の呼び出しとバッチの各リクエストで同じものを使う。 */
export function buildMessageParams(options: AnthropicToolCallOptions): Record<string, unknown> {
  const blocks = (typeof options.system === "string" ? [options.system] : [...options.system])
    .filter((text) => text !== "");
  const system = !options.cacheTtl && blocks.length === 1
    ? blocks[0]
    : blocks.map((text, index) => index === 0 && options.cacheTtl
      ? {
        type: "text",
        text,
        cache_control: options.cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" },
      }
      : { type: "text", text });
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    system,
    messages: [{ role: "user", content: options.userText }],
    output_config: {
      ...(options.effort ? { effort: options.effort } : {}),
      format: { type: "json_schema", schema: toStructuredOutputSchema(options.tool.input_schema) },
    },
  };
}

function missingApiKey(env: AnthropicEnv): AnthropicFailure | null {
  if (env.ANTHROPIC_API_KEY?.trim()) return null;
  return {
    ok: false,
    status: 503,
    error: "サーバーのAI接続設定が未完了です。",
    action: "サーバーのANTHROPIC_API_KEYを設定してください。",
  };
}

function apiHeaders(env: AnthropicEnv): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY!.trim(),
    "anthropic-version": API_VERSION,
  };
}

async function httpFailure(response: Response): Promise<AnthropicFailure> {
  const reference = response.headers.get("request-id")
    ?? response.headers.get("x-request-id")
    ?? undefined;
  console.error(
    `Anthropic API request failed with status ${response.status}`,
    reference ? `request-id=${reference}` : "request-id=unavailable",
  );
  return { ok: false, status: 502, ...providerFailure(response.status), reference };
}

/**
 * トークン数をログへ残す。費用の内訳（入力・出力・キャッシュの書き込みと読み出し）を
 * Cloudflareのログで確かめられるようにする。思考トークンは出力に含まれる。
 */
function logUsage(label: string, model: string, mode: "sync" | "batch", body: unknown): void {
  const usage = (body as { usage?: unknown } | null)?.usage;
  if (typeof usage !== "object" || usage === null) return;
  const count = (key: string): number => {
    const value = (usage as Record<string, unknown>)[key];
    return typeof value === "number" ? value : 0;
  };
  console.info("Anthropic usage", JSON.stringify({
    label,
    model,
    mode,
    input: count("input_tokens"),
    output: count("output_tokens"),
    cache_write: count("cache_creation_input_tokens"),
    cache_read: count("cache_read_input_tokens"),
  }));
}

/** Messages APIの応答本文から、スキーマどおりのJSONを取り出す。通常の呼び出しとバッチの結果で共通。 */
export function readToolResult(
  body: unknown,
  options: { model: string; maxTokens: number },
): AnthropicToolCallResult {
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

/**
 * Claude APIを1回呼び出し、構造化出力（output_config.format）でスキーマどおりのJSONを受け取る。
 * 自由記述の応答を正規表現でパースするより確実なため、出題・採点ともこの形にする。
 * Sonnet 5.5は強制ツール呼び出し（tool_choiceのtool/any）を受け付けないため、ツールは使わない。
 * tool.input_schema をそのまま出力スキーマとして使い、戻り値の input は旧来のツール入力と同じ形になる。
 */
export async function callAnthropicTool(
  env: AnthropicEnv,
  options: AnthropicToolCallOptions,
): Promise<AnthropicToolCallResult> {
  const missing = missingApiKey(env);
  if (missing) return missing;

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: apiHeaders(env),
      body: JSON.stringify(buildMessageParams(options)),
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

  if (!response.ok) return httpFailure(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, error: "AIの応答を読み取れませんでした。" };
  }
  logUsage(options.tool.name, options.model, "sync", body);
  return readToolResult(body, options);
}

/*
 * Message Batches API。結果を待つ人がいない定期バッチだけが使う（料金が半額になる）。
 * 結果は非同期に返るため、送信した回と結果を回収する回が分かれる。
 */

const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";

export type MessageBatchState =
  | { ok: true; ended: false }
  | { ok: true; ended: true; resultsUrl: string }
  | AnthropicFailure;

function batchConnectionFailure(error: unknown): AnthropicFailure {
  console.error("Anthropic batch request failed", error instanceof Error ? error.message : "unknown error");
  return {
    ok: false,
    status: 502,
    error: "AI APIへ接続できませんでした。",
    action: "次回の実行で再試行します。",
  };
}

/** 1つのバッチとして送信し、バッチIDを返す。custom_id は64文字以内の英数字・_・-。 */
export async function createMessageBatch(
  env: AnthropicEnv,
  requests: { customId: string; options: AnthropicToolCallOptions }[],
): Promise<{ ok: true; id: string } | AnthropicFailure> {
  const missing = missingApiKey(env);
  if (missing) return missing;
  let response: Response;
  try {
    response = await fetch(BATCHES_URL, {
      method: "POST",
      headers: apiHeaders(env),
      body: JSON.stringify({
        requests: requests.map(({ customId, options }) => ({ custom_id: customId, params: buildMessageParams(options) })),
      }),
    });
  } catch (error) {
    return batchConnectionFailure(error);
  }
  if (!response.ok) return httpFailure(response);
  const body = await response.json().catch(() => null) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return { ok: false, status: 502, error: "AIのバッチIDを受け取れませんでした。" };
  }
  return { ok: true, id: body.id };
}

/** バッチの処理状況を確かめる。終わっていれば結果のURLを返す。 */
export async function retrieveMessageBatch(env: AnthropicEnv, id: string): Promise<MessageBatchState> {
  const missing = missingApiKey(env);
  if (missing) return missing;
  let response: Response;
  try {
    response = await fetch(`${BATCHES_URL}/${encodeURIComponent(id)}`, { headers: apiHeaders(env) });
  } catch (error) {
    return batchConnectionFailure(error);
  }
  if (!response.ok) return httpFailure(response);
  const body = await response.json().catch(() => null) as { processing_status?: unknown; results_url?: unknown } | null;
  if (body?.processing_status !== "ended") {
    if (body?.processing_status === "in_progress" || body?.processing_status === "canceling") return { ok: true, ended: false };
    return { ok: false, status: 502, error: "AIのバッチの状態を読み取れませんでした。" };
  }
  // APIキーを付けて取りに行くため、Anthropic以外のURLは使わない。
  const resultsUrl = typeof body.results_url === "string" ? body.results_url : "";
  let host = "";
  try {
    host = new URL(resultsUrl).hostname;
  } catch {
    // 下で失敗にする。
  }
  if (host !== "api.anthropic.com") {
    return { ok: false, status: 502, error: "AIのバッチ結果の取得先を確認できませんでした。" };
  }
  return { ok: true, ended: true, resultsUrl };
}

/**
 * 終わったバッチの結果を custom_id ごとに読む。成功した応答は通常の呼び出しと同じ検証を通し、
 * 失敗・期限切れ・取り消しは理由つきの失敗にする。
 */
export async function readMessageBatchResults(
  env: AnthropicEnv,
  resultsUrl: string,
  meta: { label: string; model: string; maxTokens: number },
): Promise<{ ok: true; results: Map<string, AnthropicToolCallResult> } | AnthropicFailure> {
  const missing = missingApiKey(env);
  if (missing) return missing;
  let response: Response;
  try {
    response = await fetch(resultsUrl, { headers: apiHeaders(env) });
  } catch (error) {
    return batchConnectionFailure(error);
  }
  if (!response.ok) return httpFailure(response);
  const text = await response.text();
  const results = new Map<string, AnthropicToolCallResult>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: { custom_id?: unknown; result?: { type?: unknown; message?: unknown; error?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (typeof entry.custom_id !== "string") continue;
    const type = entry.result?.type;
    if (type === "succeeded") {
      logUsage(meta.label, meta.model, "batch", entry.result?.message);
      results.set(entry.custom_id, readToolResult(entry.result?.message, meta));
      continue;
    }
    const detail = (entry.result?.error as { error?: { type?: unknown } } | undefined)?.error?.type;
    results.set(entry.custom_id, {
      ok: false,
      status: 502,
      error: type === "expired"
        ? "AIのバッチが24時間以内に処理されず、期限切れになりました。"
        : type === "canceled"
          ? "AIのバッチが取り消されました。"
          : `AIのバッチ処理に失敗しました（${typeof detail === "string" ? detail : "理由不明"}）。`,
      action: "次回の実行で作り直します。",
    });
  }
  return { ok: true, results };
}

/** 送信したバッチを記録できなかったときに、回収されない処理を止める。失敗しても呼び出し側は続ける。 */
export async function cancelMessageBatch(env: AnthropicEnv, id: string): Promise<void> {
  if (missingApiKey(env)) return;
  try {
    const response = await fetch(`${BATCHES_URL}/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: apiHeaders(env),
    });
    if (!response.ok) console.error("Failed to cancel Anthropic batch", `status=${response.status}`);
  } catch (error) {
    console.error("Failed to cancel Anthropic batch", error instanceof Error ? error.message : "unknown error");
  }
}
