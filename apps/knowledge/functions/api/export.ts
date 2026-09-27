import { methodNotAllowed, requestSupabaseRows, type SupabaseEnv, type SupabaseTable } from "../_shared/supabaseRest.ts";

type FunctionContext = { request: Request; env: SupabaseEnv };
const PAGE_SIZE = 1_000;

async function allRows(env: SupabaseEnv, table: SupabaseTable, select: string, order: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await requestSupabaseRows(env, {
      table,
      params: new URLSearchParams({ select, order, limit: String(PAGE_SIZE), offset: String(offset) }),
    });
    if (!result.ok) throw new Error(`${table} export failed`);
    rows.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) return rows;
  }
}

function filename(now: Date): string {
  return `knowledge-export-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const now = new Date();
  try {
    const [knowledge, quizLog, speakingPracticeLog] = await Promise.all([
      allRows(env, "knowledge", "id,title,explanation,source_note,category,mastery,priority,ef,reps,interval_days,times_asked,times_correct,learned_on,last_asked_on,next_review_on,next_review_at,stability_hours,relearning_stage,last_reviewed_at,archived,created_at,accuracy,tags,mastery_streak,content_version", "created_at.desc,id.asc"),
      allRows(env, "quiz_log", "id,knowledge_id,asked_on,quality,verdict,format,note,created_at", "asked_on.desc,created_at.desc,id.desc"),
      allRows(env, "speaking_practice_log", "id,attempt_id,session_id,knowledge_id,practice_type,rating,answer_text,repetitions,practiced_at", "practiced_at.desc,id.desc"),
    ]);
    return new Response(JSON.stringify({
      schemaVersion: "knowledge-export.v1",
      exportedAt: now.toISOString(),
      readOnly: true,
      knowledge,
      quizLog,
      speakingPracticeLog,
    }, null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename(now)}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("knowledge export failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Knowledge JSONを作成できませんでした。接続状態を確認して再試行してください。" }, {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
};
