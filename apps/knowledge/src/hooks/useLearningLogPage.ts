import { useCallback, useEffect, useRef, useState } from "react";
import { getLearningLogPage } from "../lib/learningReadApi";

export function useLearningLogPage(query: string, pageSize: number, page: number, enabled = true) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getLearningLogPage>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const token = ++generation.current;
    setData(null);
    setError(null);
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    getLearningLogPage(new URLSearchParams(query), pageSize, (page - 1) * pageSize)
      .then((next) => { if (token === generation.current) setData(next); })
      .catch((caught: unknown) => { if (token === generation.current) setError(caught instanceof Error ? caught.message : "履歴を取得できませんでした。"); })
      .finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [query, pageSize, page, enabled, version]);
  return { data, loading, error, reload };
}
