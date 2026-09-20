import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { startGoogleCalendarOAuth } from "../_shared/googleCalendar.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  try {
    return await startGoogleCalendarOAuth(context.request, context.env);
  } catch (error) {
    const failure = publicError(error);
    console.error(`Google Calendar connect failed: ${failure.code}`);
    return Response.json({ error: failure.message }, {
      status: failure.status,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
