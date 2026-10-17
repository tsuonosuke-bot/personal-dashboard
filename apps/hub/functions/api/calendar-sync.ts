import { publicError } from "../_shared/dashboard.ts";
import { hasCalendarSyncCredential, syncCalendarToTodos, type CalendarSyncEnv } from "../_shared/calendarSync.ts";

interface FunctionContext {
  request: Request;
  env: CalendarSyncEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST" } });
  }
  if (!hasCalendarSyncCredential(context.request, context.env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    return Response.json(await syncCalendarToTodos(context.env), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`calendar sync failed: ${failure.code}`);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
};
