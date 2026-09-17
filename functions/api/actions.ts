import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  ACTION_CREATE,
  insertItem,
  readItemCreateInput,
  validateItemCreateRequest,
} from "../_shared/itemCreate.ts";
import {
  ACTION_UPDATE,
  readItemUpdateInput,
  updateItem,
  validateItemUpdateRequest,
} from "../_shared/itemUpdate.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "POST") {
    const guard = validateItemCreateRequest(context.request, ACTION_CREATE);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readItemCreateInput(context.request, ACTION_CREATE);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    try {
      return Response.json(await insertItem(context.env, ACTION_CREATE, input.value), { status: 201, headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`action create failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST, PATCH" } });
  }
  const guard = validateItemUpdateRequest(context.request, ACTION_UPDATE);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readItemUpdateInput(context.request, ACTION_UPDATE);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
  try {
    return Response.json(await updateItem(context.env, ACTION_UPDATE, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`action update failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
