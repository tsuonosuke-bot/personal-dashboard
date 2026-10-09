import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadProjects,
  publicProjectError,
  readProjectMilestoneUpdateInput,
  updateProjectMilestone,
  validateProjectMutationRequest,
} from "../_shared/projects.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

// マイルストンの作成・編集・完了・並べ替え・削除（#161）。成功したら最新のProject一覧を返す。
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "PATCH" } });
  }
  const guard = validateProjectMutationRequest(context.request, "project-milestone-update");
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readProjectMilestoneUpdateInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    await updateProjectMilestone(context.env, input.value);
    return Response.json(await loadProjects(context.env), { headers });
  } catch (error) {
    const failure = publicProjectError(error);
    console.error(`project milestone ${input.value.operation} failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
