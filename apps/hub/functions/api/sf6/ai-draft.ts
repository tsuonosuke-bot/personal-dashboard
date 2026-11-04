import { DashboardError, publicError, type DashboardEnv } from "../../_shared/dashboard.ts";
import {
  generateSf6AiDraft, readSf6AiDraftInput, SF6_AI_ERROR_MESSAGES, validateSf6AiDraftRequest,
} from "../../_shared/sf6AiDraft.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

// POST /api/sf6/ai-draft：文章または画像からコンボの下書きを作る（保存はしない）。
// 静的なルートなので [resource].ts より優先される。
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST" } });
  }
  const guard = validateSf6AiDraftRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readSf6AiDraftInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    return Response.json(await generateSf6AiDraft(context.env, input.value), { headers });
  } catch (error) {
    if (error instanceof DashboardError && SF6_AI_ERROR_MESSAGES[error.code]) {
      console.error(`sf6 ai draft failed: ${error.code}`);
      return Response.json({ error: SF6_AI_ERROR_MESSAGES[error.code] }, { status: error.status, headers });
    }
    const failure = publicError(error);
    console.error(`sf6 ai draft failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
