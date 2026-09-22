import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadProjects,
  processProjectItem,
  publicProjectError,
  readProjectItemProcessInput,
  validateProjectMutationRequest,
} from "../_shared/projects.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "PATCH" } });
  }

  const guard = validateProjectMutationRequest(context.request, "project-item-process");
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readProjectItemProcessInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });

  try {
    await processProjectItem(context.env, input.value);
    return Response.json(await loadProjects(context.env), { headers });
  } catch (error) {
    const failure = publicProjectError(error);
    console.error(`project item process failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
