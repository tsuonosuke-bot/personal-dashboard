import { useEffect, useState } from "react";
import { getActionSource, type ActionSource } from "../lib/api";

export function useActionSource() {
  const [data, setData] = useState<ActionSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const params = new URL(window.location.href).searchParams;
    const sourceType = params.get("sourceType");
    const sourceId = params.get("sourceId");
    if ((sourceType !== "insight" && sourceType !== "journal") || !sourceId) {
      setError("出典の指定が正しくありません。");
      return;
    }
    void getActionSource({ sourceType, sourceId }).then((source) => { if (active) setData(source); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "出典を読み込めませんでした。"); });
    return () => { active = false; };
  }, []);
  return { data, error };
}
