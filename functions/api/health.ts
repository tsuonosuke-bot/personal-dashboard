import { loadDashboard, publicError, type DashboardEnv } from "../_shared/dashboard.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  try {
    const dashboard = await loadDashboard(context.env);
    return Response.json({
      appId: dashboard.app.appId,
      version: dashboard.app.version,
      status: "ready",
      mode: dashboard.app.mode,
      systemOfRecord: dashboard.source.system,
      counts: dashboard.summary,
      timestamp: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = publicError(error);
    return Response.json({
      appId: "personal-dashboard",
      version: "0.5.0",
      status: "degraded",
      error: { code: failure.code, message: failure.message },
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
};
