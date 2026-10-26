import { useEffect, useState } from "react";
import { getJstToday } from "../lib/knowledge";

/** Refresh date-dependent values at midnight, including a tab resumed after suspension. */
export function useJstDate() {
  const [today, setToday] = useState(getJstToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date();
      const date = getJstToday(now);
      setToday(date);
      clearTimeout(timer);
      timer = setTimeout(update, Date.parse(`${date}T00:00:00+09:00`) + 86_400_000 - now.getTime() + 20);
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
