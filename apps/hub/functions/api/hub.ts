import { loadHub, publicHubError, type HubEnv } from "../_shared/hub.ts";
import { normalizeHidden } from "../_shared/homeSettings.ts";

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
    // 画面が非表示にしている欄（?hidden=journal,expenses）。知らない名前は無視する。
    const hidden = normalizeHidden((new URL(context.request.url).searchParams.get("hidden") || "").split(","));
    return Response.json(await loadHub(context.env, new Date(), { hidden }), { headers });
  } catch (error) {
    const failure = publicHubError(error);
    console.error(`hub request failed: ${failure.code}`);
    return Response.json(
      { error: { code: failure.code, message: failure.message } },
      { status: failure.status, headers },
    );
  }
};
