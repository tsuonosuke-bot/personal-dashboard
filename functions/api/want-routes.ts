import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { readWantRouteInput, routeWant, validateWantRouteRequest } from "../_shared/wantRouting.ts";
import {
  completeKnowledgeRoute,
  readKnowledgeCompletionInput,
  validateKnowledgeCompletionRequest,
} from "../_shared/wantRouteCompletion.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "PATCH") {
    const guard = validateKnowledgeCompletionRequest(context.request);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readKnowledgeCompletionInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json(await completeKnowledgeRoute(context.env, input.value), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`knowledge route completion failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST, PATCH" } });
  }
  const guard = validateWantRouteRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readWantRouteInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    const route = await routeWant(context.env, input.value);
    return Response.json(route, { status: route.status === "planned" ? 202 : 201, headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`want route failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
