import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  publicProjectError,
  readProjectSourceRouteInput,
  routeProjectSource,
  validateProjectMutationRequest,
} from "../_shared/projects.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST" } });
  }

  const guard = validateProjectMutationRequest(context.request, "project-source-route");
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readProjectSourceRouteInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });

  try {
    const projectId = await routeProjectSource(context.env, input.value);
    return Response.json({ projectId }, { status: input.value.operation === "create" ? 201 : 200, headers });
  } catch (error) {
    const failure = publicProjectError(error);
    console.error(`project source route failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
