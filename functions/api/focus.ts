import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  loadFocus,
  readFocusReorderInput,
  readFocusUpdateInput,
  reorderFocusItems,
  updateFocusItem,
  validateFocusMutationRequest,
} from "../_shared/focus.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === "GET") {
    try {
      return Response.json(await loadFocus(context.env), { headers });
    } catch (error) {
      const failure = publicError(error);
      console.error(`focus load failed: ${failure.code}`);
      return Response.json({ error: failure.message }, { status: failure.status, headers });
    }
  }

  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, PATCH" } });
  }

  const action = context.request.headers.get("X-Dashboard-Action");
  if (action !== "focus-update" && action !== "focus-reorder") {
    return Response.json({ error: "Focus更新用ヘッダーがありません。" }, { status: 403, headers });
  }
  const guard = validateFocusMutationRequest(context.request, action);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });

  try {
    if (action === "focus-update") {
      const input = await readFocusUpdateInput(context.request);
      if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
      return Response.json({ item: await updateFocusItem(context.env, input.value) }, { headers });
    }
    const input = await readFocusReorderInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    return Response.json({ items: await reorderFocusItems(context.env, input.value) }, { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`focus mutation failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
