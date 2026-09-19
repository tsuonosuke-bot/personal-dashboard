export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
}

/** 出題生成は軽量モデル、採点は精度を優先してSonnetを使う。 */
export const QUIZ_GENERATE_MODEL = "claude-haiku-4-5";
export const QUIZ_GRADE_MODEL = "claude-sonnet-5";

export type AnthropicToolCallResult =
  | { ok: true; input: unknown }
  | { ok: false; status: number; error: string };

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

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
    return { ok: false, status: 503, error: "サーバーのAI接続設定が未完了です。" };
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
    return { ok: false, status: 502, error: "AIへの接続中にエラーが発生しました。" };
  }

  if (!response.ok) {
    console.error(`Anthropic API request failed with status ${response.status}`);
    return { ok: false, status: 502, error: "AIからの応答取得に失敗しました。" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, error: "AIの応答を読み取れませんでした。" };
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
    return { ok: false, status: 502, error: "AIがツール呼び出しを返しませんでした。" };
  }
  return { ok: true, input: toolUse.input };
}
