import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadHomeSettings,
  readHomeSettingsInput,
  saveHomeSettings,
  validateHomeSettingsRequest,
} from "../_shared/homeSettings.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const method = context.request.method;
  if (method !== "GET" && method !== "PUT") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, PUT" } });
  }
  try {
    if (method === "GET") return Response.json(await loadHomeSettings(context.env), { headers });
    const guard = validateHomeSettingsRequest(context.request);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readHomeSettingsInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    return Response.json(await saveHomeSettings(context.env, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`home settings failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
