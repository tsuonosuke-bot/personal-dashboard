import { useCallback, useEffect, useState } from "react";
import { getDailyReviewStatus } from "../lib/api";
import type { DailyReviewStatus } from "../types";

export function useDailyReview(limit = 15) {
  const [status, setStatus] = useState<DailyReviewStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getDailyReviewStatus(limit));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日次復習キューを取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Reopen the queue when the next quality-specific relearning step becomes due.
  useEffect(() => {
    if (!status?.next_retry_at) return;
    const dueAt = Date.parse(status.next_retry_at);
    if (!Number.isFinite(dueAt)) return;
    const delay = Math.max(1_000, dueAt - Date.now() + 1_000);
    const timer = window.setTimeout(() => { void refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [refresh, status?.next_retry_at]);

  return { status, loading, error, refresh };
}
