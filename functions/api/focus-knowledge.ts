import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  linkFocusKnowledge,
  readFocusKnowledgeInput,
  readSearchQuery,
  searchKnowledge,
  unlinkFocusKnowledge,
  validateFocusKnowledgeRequest,
} from "../_shared/focusKnowledge.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

function failure(error: unknown, label: string): Response {
  const result = publicError(error);
  console.error(`${label} failed: ${result.code}`);
  return Response.json({ error: result.message }, { status: result.status, headers });
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const { request, env } = context;
  if (request.method === "GET") {
    const query = readSearchQuery(new URL(request.url));
    if (!query.ok) return Response.json({ error: query.error }, { status: query.status, headers });
    try {
      return Response.json({ items: await searchKnowledge(env, query.value) }, { headers });
    } catch (error) {
      return failure(error, "focus knowledge search");
    }
  }
  if (request.method !== "POST" && request.method !== "DELETE") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, POST, DELETE" } });
  }
  const action = request.method === "POST" ? "focus-knowledge-link" : "focus-knowledge-unlink";
  const guard = validateFocusKnowledgeRequest(request, action);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readFocusKnowledgeInput(request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    if (request.method === "POST") await linkFocusKnowledge(env, input.value);
    else await unlinkFocusKnowledge(env, input.value);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return failure(error, `focus knowledge ${action}`);
  }
};
