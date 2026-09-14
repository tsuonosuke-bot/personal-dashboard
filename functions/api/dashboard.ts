import { loadDashboard, publicError, type DashboardEnv } from "../_shared/dashboard.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  try {
    return Response.json(await loadDashboard(context.env), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`dashboard request failed: ${failure.code}`);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
};
