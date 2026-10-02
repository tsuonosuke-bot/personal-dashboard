import { useCallback, useEffect, useState } from "react";
import { getReviewQueueStatus } from "../lib/api";
import type { ReviewQueueStatus } from "../types";

export interface ReviewQueueStatusStore {
  status: ReviewQueueStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** 出題できる問題・採点待ち・未確認の採点結果の件数。画面を切り替えるたびに読み直す。 */
export function useReviewQueueStatus(): ReviewQueueStatusStore {
  const [status, setStatus] = useState<ReviewQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getReviewQueueStatus());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "復習キューの状態を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { status, loading, error, refresh };
}
