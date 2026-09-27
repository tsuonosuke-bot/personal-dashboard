import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../_shared/supabaseRest.ts";
import { deepDiveContent, readDeepDiveInput, validateInboxRequest } from "../_shared/inboxValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

export const INBOX_SOURCE = "knowledge-quiz";

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateInboxRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readDeepDiveInput(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);

  const source = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({ select: "id,title", id: `eq.${input.value.knowledgeId}`, limit: "1" }),
  });
  if (!source.ok) return source.response;
  const knowledge = source.rows[0] as { title?: unknown } | undefined;
  if (!knowledge) return jsonResponse({ error: "深掘り元のナレッジが見つかりません。" }, 404);
  const title = typeof knowledge.title === "string" && knowledge.title.trim() ? knowledge.title.trim() : "タイトルなし";

  const inserted = await requestSupabaseRows(context.env, {
    table: "idea_inbox",
    method: "POST",
    params: new URLSearchParams({ select: "id,created_at" }),
    body: { content: deepDiveContent(input.value, title), status: "pending", source: INBOX_SOURCE },
  });
  if (!inserted.ok) return inserted.response;
  const row = inserted.rows[0] as { id?: unknown; created_at?: unknown } | undefined;
  if (inserted.rows.length !== 1 || !row || !Number.isSafeInteger(row.id) || typeof row.created_at !== "string") {
    return jsonResponse({ error: "Inboxへの登録結果を確認できませんでした。" }, 502);
  }
  return jsonResponse({ id: row.id, createdAt: row.created_at }, 201);
};
