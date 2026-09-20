import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadWriting,
  readWritingUpdateInput,
  updateWritingTopic,
  validateWritingMutationRequest,
} from "../_shared/writing.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    try {
      return Response.json(await loadWriting(context.env), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`writing load failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }

  if (context.request.method === "PATCH") {
    const guard = validateWritingMutationRequest(context.request);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readWritingUpdateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json({ item: await updateWritingTopic(context.env, input.value) }, { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`writing update failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }

  return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, PATCH" } });
};
