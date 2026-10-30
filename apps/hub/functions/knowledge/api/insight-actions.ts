import { actionInboxContent, loadActionSource, readActionInput, readActionReference } from "../_shared/insightAction.ts";
import { validateInboxRequest } from "../_shared/inboxValidation.ts";
import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../_shared/supabaseRest.ts";

export const onRequest = async ({ request, env }: { request: Request; env: SupabaseEnv }): Promise<Response> => {
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const ref = readActionReference(params.get("sourceType"), params.get("sourceId"));
    if (!ref || [...params.keys()].sort().join(",") !== "sourceId,sourceType") return jsonResponse({ error: "出典の指定が正しくありません。" }, 400);
    const source = await loadActionSource(env, ref);
    return source.ok ? jsonResponse(source.value) : source.response;
  }
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const guard = validateInboxRequest(request, "insight-action");
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readActionInput(request);
  if (!input.ok) return input.response;
  const source = await loadActionSource(env, input.value);
  if (!source.ok) return source.response;
  const inserted = await requestSupabaseRows(env, {
    table: "idea_inbox", method: "POST", params: new URLSearchParams({ select: "id,created_at" }),
    body: { content: actionInboxContent(input.value.note, source.value), status: "pending", source: "knowledge-insight-action" },
  });
  if (!inserted.ok) return inserted.response;
  const row = inserted.rows[0] as { id?: unknown; created_at?: unknown } | undefined;
  if (inserted.rows.length !== 1 || !row || !Number.isSafeInteger(row.id) || typeof row.created_at !== "string") {
    return jsonResponse({ error: "Inboxへの登録結果を確認できませんでした。" }, 502);
  }
  return jsonResponse({ id: row.id, createdAt: row.created_at }, 201);
};
