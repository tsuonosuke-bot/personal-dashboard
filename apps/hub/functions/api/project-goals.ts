import { type DashboardEnv, DashboardError } from "../_shared/dashboard.ts";
import { validateProjectMutationRequest } from "../_shared/projectValidation.ts";
import {
  loadProjectGoalStatus,
  readProjectGoalInput,
  saveProjectGoal,
} from "../_shared/projectGoals.ts";

const headers = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
export async function onRequest({ request, env }: { request: Request; env: DashboardEnv }) {
  try {
    if (request.method === "GET") {
      const raw = new URL(request.url).searchParams.get("ids") ?? "";
      const ids = [...new Set(raw.split(",").map(Number))];
      if (!raw || ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
        return Response.json(
          { error: "対象のProjectが正しくありません。" },
          { status: 400, headers },
        );
      return Response.json({ goals: await loadProjectGoalStatus(env, ids) }, { headers });
    }
    if (request.method !== "POST")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...headers, Allow: "GET, POST" },
      });
    const guard = validateProjectMutationRequest(request, "project-goal-update");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const text = await request.text();
    let value: unknown;
    try {
      value = text.length <= 20000 ? JSON.parse(text) : null;
    } catch {
      value = null;
    }
    const input = readProjectGoalInput(value);
    if (!input)
      return Response.json({ error: "入力内容を確認してください。" }, { status: 400, headers });
    return Response.json(await saveProjectGoal(env, input), { headers });
  } catch (error) {
    const known = error instanceof DashboardError;
    return Response.json(
      {
        error: known
          ? error.message
          : "通信結果を確認できませんでした。入力を残して再試行してください。",
        canRebase: known && error.code === "PROJECT_CONFLICT",
      },
      { status: known ? error.status : 502, headers },
    );
  }
}
