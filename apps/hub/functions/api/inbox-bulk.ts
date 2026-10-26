import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import {
  readInboxBulkUpdateInput,
  validateInboxBulkUpdateRequest,
} from "../_shared/inboxBulkUpdate.ts";
import { updateInbox } from "../_shared/inboxUpdate.ts";
import { mapConcurrent } from "../_shared/concurrency.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "PATCH") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "PATCH" } });
  }
  const guard = validateInboxBulkUpdateRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  const input = await readInboxBulkUpdateInput(context.request);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });

  const updated: number[] = [];
  const failed: Array<{ id: number; error: string }> = [];
  await mapConcurrent(input.value.items, 4, async (item) => {
    try {
      await updateInbox(context.env, {
        id: item.id,
        content: item.original.content,
        status: input.value.status,
        result: item.original.result,
        original: item.original,
      });
      updated.push(item.id);
    } catch (error) {
      const failure = publicError(error);
      console.error(`inbox bulk update failed for ${item.id}: ${failure.code}`);
      failed.push({ id: item.id, error: failure.message });
    }
  });

  // Preserve the request's ordering even when independent updates finish out of order.
  const order = new Map(input.value.items.map((item, index) => [item.id, index]));
  updated.sort((left, right) => order.get(left)! - order.get(right)!);
  failed.sort((left, right) => order.get(left.id)! - order.get(right.id)!);

  return Response.json({ status: input.value.status, updated, failed }, { status: failed.length ? 207 : 200, headers });
};
