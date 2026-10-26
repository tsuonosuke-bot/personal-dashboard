import { type DashboardEnv, publicError } from "../_shared/dashboard.ts";
import { loadProjectReadModel } from "../_shared/projectsRead.ts";
import { listScheduledActions } from "../_shared/scheduledActions.ts";

/** One request-local ToDo read is shared with Project normalization. No cross-user cache. */
export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: DashboardEnv;
}): Promise<Response> => {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "GET")
    return new Response("Method Not Allowed\n", {
      status: 405,
      headers: { ...headers, Allow: "GET" },
    });
  const todos = listScheduledActions(env, { scope: "today" });
  const [todoResult, projectResult] = await Promise.allSettled([
    todos,
    loadProjectReadModel(env, { view: "today" }, todos),
  ]);
  const result = <T>(value: PromiseSettledResult<T>) =>
    value.status === "fulfilled"
      ? { data: value.value }
      : { error: publicError(value.reason).message };
  return Response.json({ todos: result(todoResult), projects: result(projectResult) }, { headers });
};
