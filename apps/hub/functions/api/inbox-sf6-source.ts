import { publicError, type DashboardEnv } from "../_shared/dashboard.ts";
import { INBOX_SF6_RESOURCES, loadInboxSf6Source } from "../_shared/inboxSf6.ts";

export const onRequest = async ({ request, env }: { request: Request; env: DashboardEnv }): Promise<Response> => {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { ...headers, Allow: "GET" } });
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  const resource = params.get("resource") as typeof INBOX_SF6_RESOURCES[number];
  const targetId = Number(params.get("targetId"));
  const byInbox = Number.isSafeInteger(id) && id > 0 && params.size === 1;
  const byTarget = INBOX_SF6_RESOURCES.includes(resource) && Number.isSafeInteger(targetId) && targetId > 0 && params.size === 2;
  if (!byInbox && !byTarget) return Response.json({ error: "元InboxまたはSF6の登録先を指定してください。" }, { status: 400, headers });
  try {
    return Response.json(await loadInboxSf6Source(env, byInbox ? { inboxId: id } : { resource, targetId }), { headers });
  } catch (error) {
    const failure = publicError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
