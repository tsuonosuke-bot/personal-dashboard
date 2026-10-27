import type { DashboardEnv } from "../_shared/dashboard.ts";
import {
  createProjectSchedule,
  getProjectScheduleOperation,
  publicProjectScheduleError,
  readProjectScheduleInput,
  validateProjectScheduleRequest,
} from "../_shared/projectSchedule.ts";

const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};
export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: DashboardEnv;
}): Promise<Response> => {
  let actionId: number | null = null;
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const rawId = url.searchParams.get("actionId");
      if (
        !rawId ||
        !/^[1-9]\d*$/.test(rawId) ||
        !Number.isSafeInteger(Number(rawId)) ||
        [...url.searchParams.keys()].some((key) => key !== "actionId") ||
        url.searchParams.getAll("actionId").length !== 1
      ) {
        return Response.json({ error: "Action IDが正しくありません。" }, { status: 400, headers });
      }
      actionId = Number(rawId);
      return Response.json(
        { operation: await getProjectScheduleOperation(env, actionId) },
        { headers },
      );
    }
    if (request.method !== "POST")
      return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET, POST" } });
    const guard = validateProjectScheduleRequest(request);
    if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
    const input = await readProjectScheduleInput(request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    actionId = input.value.actionId;
    return Response.json({ operation: await createProjectSchedule(env, input.value) }, { headers });
  } catch (error) {
    const failure = publicProjectScheduleError(error);
    let operation;
    try {
      if (actionId !== null) operation = await getProjectScheduleOperation(env, actionId);
    } catch {
      /* Explicit unknown result when the database is unavailable. */
    }
    return Response.json(
      {
        error: { code: failure.code, message: failure.message },
        ...(operation !== undefined ? { operation } : {}),
        resultUnknown: operation === undefined || operation?.stage === "planned",
      },
      { status: failure.status, headers },
    );
  }
};
