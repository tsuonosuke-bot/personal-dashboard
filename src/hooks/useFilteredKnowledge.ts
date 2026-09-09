import { useMemo } from "react";
import { ALL } from "../constants";
import type { Filters, Knowledge } from "../types";

export function useFilteredKnowledge(knowledge: Knowledge[], filters: Filters) {
  return useMemo(() => {
    const s = filters.search.trim().toLowerCase();
    return knowledge.filter((k) => {
      if (filters.category !== ALL && k.category !== filters.category) return false;
      if (filters.mastery !== ALL && k.mastery !== filters.mastery) return false;
      if (s) {
        const hay = [k.title ?? "", k.explanation ?? "", (k.tags ?? []).join(" ")]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [knowledge, filters]);
}
