import { useEffect, useState } from "react";
import { getMasteryHistory } from "../lib/api";
import type { MasteryHistoryEvent } from "../types";

/** 他のグラフの表示を妨げないよう、ダッシュボード本体とは別に取得する。 */
export function useMasteryHistory(reloadKey: unknown) {
  const [events, setEvents] = useState<MasteryHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMasteryHistory()
      .then((loaded) => { if (!cancelled) setEvents(loaded); })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "習熟度の履歴を取得できませんでした。");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  return { events, loading, error };
}
