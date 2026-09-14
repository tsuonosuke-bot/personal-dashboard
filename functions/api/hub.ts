import { loadHub, publicHubError, type HubEnv } from "../_shared/hub.ts";

interface FunctionContext {
  request: Request;
  env: HubEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  try {
    return Response.json(await loadHub(context.env), { headers });
  } catch (error) {
    const failure = publicHubError(error);
    console.error(`hub request failed: ${failure.code}`);
    return Response.json(
      { error: { code: failure.code, message: failure.message } },
      { status: failure.status, headers },
    );
  }
};
