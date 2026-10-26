import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  createProjectAction,
  publicProjectError,
  readProjectActionCreateInput,
  readProjectActionResolveInput,
  readProjectActionUpdateInput,
  resolveProjectAction,
  updateProjectAction,
  validateProjectMutationRequest,
} from "../_shared/projects.ts";
import { findMutationProjectId, projectMutationResult } from "../_shared/projectsRead.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

function failureResponse(error: unknown, operation: string): Response {
  const failure = publicProjectError(error);
  console.error(`project actions ${operation} failed: ${failure.code}`);
  return Response.json({ error: failure.message }, { status: failure.status, headers });
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "POST") {
    const guard = validateProjectMutationRequest(context.request, "project-action-create");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectActionCreateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      await createProjectAction(context.env, input.value);
      return Response.json(await projectMutationResult(context.env, input.value.projectId, context.request), { status: 201, headers });
    } catch (error) {
      return failureResponse(error, input.value.operation);
    }
  }

  if (context.request.method === "PATCH") {
    const guard = validateProjectMutationRequest(context.request, "project-action-resolve");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectActionResolveInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      const projectId = await findMutationProjectId(context.env, "project_actions", input.value.actionId);
      await resolveProjectAction(context.env, input.value);
      return Response.json(await projectMutationResult(context.env, projectId, context.request), { headers });
    } catch (error) {
      return failureResponse(error, "resolve");
    }
  }

  if (context.request.method === "PUT") {
    const guard = validateProjectMutationRequest(context.request, "project-action-update");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectActionUpdateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      const projectId = await findMutationProjectId(context.env, "project_actions", input.value.actionId);
      await updateProjectAction(context.env, input.value);
      return Response.json(await projectMutationResult(context.env, projectId, context.request), { headers });
    } catch (error) {
      return failureResponse(error, input.value.operation);
    }
  }

  return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST, PATCH, PUT" } });
};
