import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";
import {
  issueRecoveryToken,
  verifyRecoveryToken,
  type RecoveryAssignment,
} from "../../_shared/recoveryPreview.ts";
import type { QuizSigningEnv } from "../../_shared/quizSession.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv & QuizSigningEnv;
}

interface PreviewRow extends RecoveryAssignment {
  title: string;
  priority: string;
  accuracy: number | null;
  overdue_days: number;
  queue_position: number;
}

// A signed preview may contain every overdue item (up to the DB-side 5,000 cap).
const MAX_REQUEST_CHARS = 300_000;

function guard(request: Request): Response | null {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return jsonResponse({ error: "許可されていない送信元です。" }, 403);
  }
  if (request.headers.get("X-Dashboard-Action") !== "review-recovery") {
    return jsonResponse({ error: "回復操作用ヘッダーがありません。" }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "JSON形式で送信してください。" }, 415);
  }
  const length = Number(request.headers.get("Content-Length") ?? "0");
  return Number.isFinite(length) && length > MAX_REQUEST_CHARS
    ? jsonResponse({ error: "リクエストが大きすぎます。" }, 413)
    : null;
}

async function readBody(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > MAX_REQUEST_CHARS) return jsonResponse({ error: "リクエストが大きすぎます。" }, 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return jsonResponse({ error: "JSONの形式が正しくありません。" }, 400);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseRows(value: unknown): PreviewRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: PreviewRow[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const accuracy = item.accuracy === null ? null : Number(item.accuracy);
    const overdueDays = Number(item.overdue_days);
    const queuePosition = Number(item.queue_position);
    if (
      typeof item.knowledge_id !== "string" || typeof item.title !== "string"
      || typeof item.priority !== "string" || !validDate(item.current_next_review_on)
      || !validDate(item.scheduled_on) || !Number.isInteger(overdueDays) || overdueDays < 1
      || !Number.isInteger(queuePosition) || queuePosition < 1
      || (accuracy !== null && !Number.isFinite(accuracy))
    ) return null;
    rows.push({
      knowledge_id: item.knowledge_id,
      title: item.title,
      priority: item.priority,
      accuracy,
      overdue_days: overdueDays,
      current_next_review_on: item.current_next_review_on,
      scheduled_on: item.scheduled_on,
      queue_position: queuePosition,
    });
  }
  return rows;
}

function previewResponse(rows: PreviewRow[], dailyLimit: number, token: string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.scheduled_on, (counts.get(row.scheduled_on) ?? 0) + 1);
  const days = [...counts].map(([date, count]) => ({ date, count }));
  return {
    total: rows.length,
    daily_limit: dailyLimit,
    from: days[0]?.date ?? null,
    through: days.length > 0 ? days[days.length - 1].date : null,
    days,
    sample: rows.slice(0, 8).map((row) => ({
      id: row.knowledge_id,
      title: row.title,
      priority: row.priority,
      accuracy: row.accuracy,
      overdue_days: row.overdue_days,
      current_next_review_on: row.current_next_review_on,
      scheduled_on: row.scheduled_on,
    })),
    token,
  };
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const guarded = guard(context.request);
  if (guarded) return guarded;
  const body = await readBody(context.request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return jsonResponse({ error: "入力内容の形式が正しくありません。" }, 400);

  if (body.action === "preview") {
    const dailyLimit = Number(body.daily_limit ?? 15);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 30) {
      return jsonResponse({ error: "daily_limitは1〜30の整数で指定してください。" }, 400);
    }
    const result = await requestSupabaseFunction(context.env, "preview_review_recovery", {
      p_daily_limit: dailyLimit,
    });
    if (!result.ok) return result.response;
    const rows = parseRows(result.data);
    if (!rows) return jsonResponse({ error: "回復プレビューの応答が正しくありません。" }, 502);
    if (rows.length === 0) return jsonResponse(previewResponse([], dailyLimit, ""));
    const signed = await issueRecoveryToken(
      dailyLimit,
      rows.map(({ knowledge_id, current_next_review_on, scheduled_on }) => ({
        knowledge_id, current_next_review_on, scheduled_on,
      })),
      context.request,
      context.env,
    );
    if (!signed.ok) return jsonResponse({ error: signed.error }, signed.status);
    return jsonResponse(previewResponse(rows, dailyLimit, signed.token));
  }

  if (body.action === "apply") {
    if (typeof body.token !== "string") return jsonResponse({ error: "プレビュートークンが必要です。" }, 400);
    const verified = await verifyRecoveryToken(body.token, context.request, context.env);
    if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);
    const result = await requestSupabaseFunction(context.env, "apply_review_recovery", {
      p_assignments: verified.assignments,
    });
    if (!result.ok) return result.response;
    const updated = Number(result.data);
    if (!Number.isInteger(updated) || updated !== verified.assignments.length) {
      return jsonResponse({ error: "回復処理の更新件数を確認できませんでした。" }, 502);
    }
    return jsonResponse({ updated, daily_limit: verified.dailyLimit });
  }

  return jsonResponse({ error: "actionはpreviewまたはapplyを指定してください。" }, 400);
};
