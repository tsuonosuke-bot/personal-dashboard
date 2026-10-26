import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { loadIdeaReadModel, readIdeaQuery } from "../_shared/dashboardRead.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  const query = readIdeaQuery(new URL(context.request.url));
  if (!query) return Response.json({error:"Ideaの取得条件が正しくありません。"},{status:400,headers});
  try {
    return Response.json(await loadIdeaReadModel(context.env,query), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`dashboard request failed: ${failure.code}`);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
};
