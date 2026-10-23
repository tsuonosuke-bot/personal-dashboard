import type { DashboardEnv } from "../_shared/dashboard.ts";
import { loadProjects, validateProjectMutationRequest } from "../_shared/projects.ts";
import { listScheduledActions } from "../_shared/scheduledActions.ts";
import { projectTodoRpc, publicProjectTodoError, readProjectTodoLinkInput } from "../_shared/projectActionTodos.ts";

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };
export const onRequest = async ({ request, env }: { request: Request; env: DashboardEnv }): Promise<Response> => {
  try {
    if (request.method === "GET") {
      const [projects, todos] = await Promise.all([loadProjects(env), listScheduledActions(env)]);
      return Response.json({ projects: projects.projects, todos: todos.items }, { headers });
    }
    if (request.method !== "POST" && request.method !== "DELETE") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, POST, DELETE" } });
    const guard = validateProjectMutationRequest(request, "project-todo-link");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectTodoLinkInput(request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    const projectId = await projectTodoRpc(env, request.method === "POST" ? "link_project_action_todo" : "unlink_project_action_todo", { p_request: input.value });
    if (!Number.isSafeInteger(projectId) || Number(projectId) <= 0) throw new Error("Invalid link result");
    return Response.json({ projectId, linked: request.method === "POST" }, { headers });
  } catch (error) {
    const failure = publicProjectTodoError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
