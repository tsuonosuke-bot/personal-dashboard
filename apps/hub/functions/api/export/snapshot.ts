import { createFullSnapshot, exportFailureMessage } from "../../_shared/exportSnapshot.ts";
import type { HubEnv } from "../../_shared/hub.ts";

interface FunctionContext {
  request: Request;
  env: HubEnv;
}

function filename(now: Date): string {
  return `personal-hub-snapshot-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  const now = new Date();
  try {
    return new Response(JSON.stringify(await createFullSnapshot(env, now), null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename(now)}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: { message: exportFailureMessage(error) } }, {
      status: 502,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
