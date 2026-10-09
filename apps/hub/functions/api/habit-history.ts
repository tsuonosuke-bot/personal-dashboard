import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { loadHabitHistory, readHabitHistoryQuery } from "../_shared/habits.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

/** 週・月を指定したHabitの履歴（#141）。GET /api/habit-history?period=week&anchor=YYYY-MM-DD / period=month&anchor=YYYY-MM */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  const query = readHabitHistoryQuery(new URL(context.request.url));
  if (!query.ok) return Response.json({ error: query.error }, { status: query.status, headers });
  try {
    return Response.json(await loadHabitHistory(context.env, query.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`habit history request failed: ${failure.code}`);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
};
