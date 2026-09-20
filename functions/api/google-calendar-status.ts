import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { getGoogleCalendarConnectionStatus } from "../_shared/googleCalendar.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  try {
    return Response.json(await getGoogleCalendarConnectionStatus(context.env), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`Google Calendar status failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
