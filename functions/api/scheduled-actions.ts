import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  listScheduledActions,
  readScheduledActionInput,
  updateScheduledAction,
  validateScheduledActionRequest,
} from "../_shared/scheduledActions.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    try {
      return Response.json(await listScheduledActions(context.env), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`scheduled actions load failed: ${failure.code}`);
      return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
    }
  }
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, PATCH" } });
  }
  const guard = validateScheduledActionRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readScheduledActionInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    return Response.json(await updateScheduledAction(context.env, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`scheduled action update failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
