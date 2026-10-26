import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  applyHabitLog,
  loadHabitMutationResult,
  readHabitHistoryQuery,
  readHabitLogInput,
  validateHabitMutationRequest,
} from "../_shared/habits.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "PATCH" } });
  }
  const guard = validateHabitMutationRequest(context.request, "habit-log");
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readHabitLogInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  const history = readHabitHistoryQuery(new URL(context.request.url));
  if (!history.ok) return Response.json({ error: history.error }, { status: history.status, headers });
  try {
    const saved = await applyHabitLog(context.env, input.value);
    try {
      return Response.json({ ...saved, update: await loadHabitMutationResult(context.env, input.value.habitId, history.value) }, { headers });
    } catch {
      // The write succeeded. A failed refresh must never encourage the user to repeat it.
      return Response.json({ ...saved, saved: true, refreshError: "記録は保存されました。最新の集計を取得できませんでした。再読み込みしてください。" }, { headers });
    }
  } catch (error) {
    const failure = publicError(error);
    console.error(`habit log failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
