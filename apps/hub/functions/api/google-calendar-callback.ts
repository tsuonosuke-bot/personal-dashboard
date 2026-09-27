import type { DashboardEnv } from "../_shared/dashboard.ts";
import { handleGoogleCalendarOAuthCallback } from "../_shared/googleCalendar.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  return handleGoogleCalendarOAuthCallback(context.request, context.env);
};
