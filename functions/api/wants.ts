import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  insertItem,
  readItemCreateInput,
  validateItemCreateRequest,
  WANT_CREATE,
} from "../_shared/itemCreate.ts";
import {
  readItemUpdateInput,
  updateItem,
  validateItemUpdateRequest,
  WANT_UPDATE,
} from "../_shared/itemUpdate.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "POST") {
    const guard = validateItemCreateRequest(context.request, WANT_CREATE);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readItemCreateInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json(await insertItem(context.env, WANT_CREATE, input.value), { status: 201, headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`want create failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST, PATCH" } });
  }
  const guard = validateItemUpdateRequest(context.request, WANT_UPDATE);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readItemUpdateInput(context.request, WANT_UPDATE);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    return Response.json(await updateItem(context.env, WANT_UPDATE, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`want update failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
