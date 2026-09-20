import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  createHabit,
  loadHabits,
  readHabitCreateInput,
  readHabitUpdateInput,
  updateHabit,
  validateHabitMutationRequest,
} from "../_shared/habits.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    try {
      return Response.json(await loadHabits(context.env), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`habits request failed: ${failure.code}`);
      return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
    }
  }

  if (context.request.method === "POST") {
    const guard = validateHabitMutationRequest(context.request, "habit-create");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readHabitCreateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json(await createHabit(context.env, input.value), { status: 201, headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`habit create failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }

  if (context.request.method === "PATCH") {
    const guard = validateHabitMutationRequest(context.request, "habit-update");
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readHabitUpdateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json(await updateHabit(context.env, input.value), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`habit update failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }

  return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, POST, PATCH" } });
};
