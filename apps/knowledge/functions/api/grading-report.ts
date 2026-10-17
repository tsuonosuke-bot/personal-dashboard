import { jsonResponse, methodNotAllowed, requestSupabaseRows, type SupabaseEnv } from "../_shared/supabaseRest.ts";
import {
  gradingReportContent,
  readGradingReportInput,
  validateGradingReportRequest,
} from "../_shared/gradingReportValidation.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

/** Inboxで「採点の報告」と見分けるための出典。Ideaの未整理Inboxや source での絞り込みで見直せる。 */
export const GRADING_REPORT_SOURCE = "knowledge-grading-report";

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guard = validateGradingReportRequest(context.request);
  if (guard) return jsonResponse({ error: guard.error }, guard.status);
  const input = await readGradingReportInput(context.request);
  if (!input.ok) return jsonResponse({ error: input.error }, input.status);

  const source = await requestSupabaseRows(context.env, {
    table: "knowledge",
    params: new URLSearchParams({ select: "id,title", id: `eq.${input.value.knowledgeId}`, limit: "1" }),
  });
  if (!source.ok) return source.response;
  const knowledge = source.rows[0] as { title?: unknown } | undefined;
  if (!knowledge) return jsonResponse({ error: "報告元のナレッジが見つかりません。" }, 404);
  const title = typeof knowledge.title === "string" && knowledge.title.trim() ? knowledge.title.trim() : "タイトルなし";

  const inserted = await requestSupabaseRows(context.env, {
    table: "idea_inbox",
    method: "POST",
    params: new URLSearchParams({ select: "id,created_at" }),
    body: { content: gradingReportContent(input.value, title), status: "pending", source: GRADING_REPORT_SOURCE },
  });
  if (!inserted.ok) return inserted.response;
  const row = inserted.rows[0] as { id?: unknown; created_at?: unknown } | undefined;
  if (inserted.rows.length !== 1 || !row || !Number.isSafeInteger(row.id) || typeof row.created_at !== "string") {
    return jsonResponse({ error: "採点の報告を登録できたか確認できませんでした。" }, 502);
  }
  return jsonResponse({ id: row.id, createdAt: row.created_at }, 201);
};
