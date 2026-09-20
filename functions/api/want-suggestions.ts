import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { readAiTriageInput, suggestWantRoutes, validateAiTriageRequest } from "../_shared/aiTriage.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST" } });
  }
  const guard = validateAiTriageRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readAiTriageInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    return Response.json(await suggestWantRoutes(context.env, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`want AI suggestion failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
