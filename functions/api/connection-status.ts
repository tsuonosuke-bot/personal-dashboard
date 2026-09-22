import { loadConnectionStatus, type ConnectionStatusEnv } from "../_shared/connectionStatus.ts";

interface FunctionContext {
  request: Request;
  env: ConnectionStatusEnv;
}

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  return Response.json(await loadConnectionStatus(env), {
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" },
  });
};
