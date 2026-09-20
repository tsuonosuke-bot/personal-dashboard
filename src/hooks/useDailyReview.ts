import { useCallback, useEffect, useState } from "react";
import {
  applyReviewRecovery,
  getDailyReviewStatus,
  previewReviewRecovery,
} from "../lib/api";
import type { DailyReviewStatus, RecoveryPreview } from "../types";

export function useDailyReview(limit = 15) {
  const [status, setStatus] = useState<DailyReviewStatus | null>(null);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
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

  const createPreview = useCallback(async () => {
    setMutating(true);
    setError(null);
    try {
      const next = await previewReviewRecovery(limit);
      setPreview(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回復プレビューを作成できませんでした。");
      return null;
    } finally {
      setMutating(false);
    }
  }, [limit]);

  const applyPreview = useCallback(async () => {
    if (!preview?.token) return 0;
    setMutating(true);
    setError(null);
    try {
      const updated = await applyReviewRecovery(preview.token);
      setPreview(null);
      await refresh();
      return updated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回復処理を実行できませんでした。");
      return 0;
    } finally {
      setMutating(false);
    }
  }, [preview, refresh]);

  return {
    status, preview, loading, mutating, error,
    refresh, createPreview, applyPreview, clearPreview: () => setPreview(null),
  };
}
