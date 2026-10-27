import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadProjectHabits,
  mutateProjectHabit,
  readProjectHabitInput,
  readProjectHabitQuery,
  validateProjectHabitRequest,
} from "../_shared/projectHabits.ts";

const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};
export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: DashboardEnv;
}): Promise<Response> => {
  try {
    if (request.method === "GET") {
      const query = readProjectHabitQuery(request);
      if (!query.ok)
        return Response.json({ error: query.error }, { status: query.status, headers });
      return Response.json(await loadProjectHabits(env, query.value), { headers });
    }
    if (request.method !== "POST" && request.method !== "DELETE")
      return new Response("Method Not Allowed\n", {
        status: 405,
        headers: { Allow: "GET, POST, DELETE" },
      });
    const guard = validateProjectHabitRequest(request);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectHabitInput(request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    return Response.json(await mutateProjectHabit(env, input.value, request.method === "POST"), {
      headers,
    });
  } catch (error) {
    const failure = publicError(error);
    const message =
      failure.status === 409
        ? "目標・習慣・関連づけが更新されました。再読み込みしてからやり直してください。"
        : failure.code === "PROJECT_NOT_FOUND"
          ? "目標が見つかりません。再読み込みしてください。"
          : failure.message;
    return Response.json(
      { error: message, code: failure.code },
      { status: failure.status, headers },
    );
  }
};
