import {
  jsonResponse,
  methodNotAllowed,
  requestSupabaseFunction,
  type SupabaseEnv,
} from "../../_shared/supabaseRest.ts";

interface FunctionContext {
  request: Request;
  env: SupabaseEnv;
}

function readLimit(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get("limit") ?? "15";
  if (!/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isInteger(limit) && limit >= 1 && limit <= 30 ? limit : null;
}

function integer(record: Record<string, unknown>, key: string): number | null {
  const value = Number(record[key]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function categoryCounts(value: unknown, expectedTotal: number): { category: string; count: number }[] | null {
  if (!Array.isArray(value)) return null;
  const result: { category: string; count: number }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const category = record.category;
    const count = Number(record.count);
    if (
      typeof category !== "string" || !category.trim() || seen.has(category)
      || !Number.isSafeInteger(count) || count < 0
    ) return null;
    seen.add(category);
    total += count;
    result.push({ category, count });
  }
  return total === expectedTotal ? result : null;
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const limit = readLimit(context.request);
  if (limit === null) return jsonResponse({ error: "limitは1〜30の整数で指定してください。" }, 400);

  const result = await requestSupabaseFunction(context.env, "get_daily_review_status", {
    p_limit: limit,
  });
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    return jsonResponse({ error: "日次復習キューの状態を確認できませんでした。" }, 502);
  }
  const row = result.data[0] as Record<string, unknown>;
  const reviewOn = row.review_on;
  const queueLimit = integer(row, "queue_limit");
  const total = integer(row, "queue_total");
  const completed = integer(row, "completed");
  const completedUnique = integer(row, "completed_unique");
  const remaining = integer(row, "remaining");
  const dueTotal = integer(row, "due_total");
  const overdueTotal = integer(row, "overdue_total");
  const retryReady = integer(row, "retry_ready");
  const retryWaiting = integer(row, "retry_waiting");
  const nextRetryAt = row.next_retry_at;
  const newLimit = integer(row, "new_limit");
  const newHeld = integer(row, "new_held");
  const remainingByCategory = remaining === null
    ? null
    : categoryCounts(row.remaining_by_category, remaining);
  if (
    typeof reviewOn !== "string" || queueLimit === null || total === null || completed === null
    || completedUnique === null
    || remaining === null || dueTotal === null || overdueTotal === null
    || retryReady === null || retryWaiting === null || remainingByCategory === null
    || newLimit === null || newHeld === null
    || (nextRetryAt !== null && typeof nextRetryAt !== "string")
    || completed + remaining !== total
  ) return jsonResponse({ error: "日次復習キューの応答が正しくありません。" }, 502);

  return jsonResponse({
    review_on: reviewOn,
    limit: queueLimit,
    total,
    completed,
    completed_unique: completedUnique,
    remaining,
    due_total: dueTotal,
    overdue_total: overdueTotal,
    retry_ready: retryReady,
    retry_waiting: retryWaiting,
    next_retry_at: nextRetryAt,
    remaining_by_category: remainingByCategory,
    new_limit: newLimit,
    new_held: newHeld,
  });
};
