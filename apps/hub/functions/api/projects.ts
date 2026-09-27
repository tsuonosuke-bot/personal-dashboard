import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  createProject,
  loadProjects,
  publicProjectError,
  readProjectCreateInput,
  readProjectUpdateInput,
  updateProject,
  validateProjectMutationRequest,
} from "../_shared/projects.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

function failureResponse(error: unknown, operation: string): Response {
  const failure = publicProjectError(error);
  console.error(`projects ${operation} failed: ${failure.code}`);
  return Response.json({ error: failure.message }, { status: failure.status, headers });
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    try {
      return Response.json(await loadProjects(context.env), { headers });
    } catch (error) {
      return failureResponse(error, "load");
    }
  }

  if (context.request.method === "POST") {
    const guard = validateProjectMutationRequest(context.request, "project-create");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectCreateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      await createProject(context.env, input.value);
      return Response.json(await loadProjects(context.env), { status: 201, headers });
    } catch (error) {
      return failureResponse(error, "create");
    }
  }

  if (context.request.method === "PATCH") {
    const guard = validateProjectMutationRequest(context.request, "project-update");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectUpdateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      await updateProject(context.env, input.value);
      return Response.json(await loadProjects(context.env), { headers });
    } catch (error) {
      return failureResponse(error, "update");
    }
  }

  return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, POST, PATCH" } });
};
