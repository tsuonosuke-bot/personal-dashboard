import { callRpc, firstRow } from "../../_shared/reviewQueue.ts";
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

const COUNT_KEYS = ["ready_total", "ready_due", "waiting_grading", "grading_errors", "unconfirmed_results", "queue_limit"] as const;

/** 出題できる問題・採点待ち・未確認の採点結果の件数と、直近のバッチ実行状況。 */
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  let row: Record<string, unknown> | null;
  try {
    row = firstRow(await callRpc(context.env, "get_review_queue_status", {}));
  } catch {
    return jsonResponse({ error: "復習キューの状態を確認できませんでした。" }, 502);
  }
  if (!row || COUNT_KEYS.some((key) => !Number.isSafeInteger(row![key]) || (row![key] as number) < 0)) {
    return jsonResponse({ error: "復習キューの応答が正しくありません。" }, 502);
  }
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const count = (value: unknown) => (Number.isSafeInteger(value) ? value as number : null);
  return jsonResponse({
    ready_total: row.ready_total,
    ready_due: row.ready_due,
    waiting_grading: row.waiting_grading,
    grading_errors: row.grading_errors,
    unconfirmed_results: row.unconfirmed_results,
    queue_limit: row.queue_limit,
    queue_full: row.queue_full === true,
    last_generate: row.last_generate_at
      ? {
        at: text(row.last_generate_at),
        status: text(row.last_generate_status),
        added: count(row.last_generate_added),
        note: text(row.last_generate_note),
      }
      : null,
    last_grade: row.last_grade_at ? { at: text(row.last_grade_at), status: text(row.last_grade_status) } : null,
  });
};
