import { useMemo } from "react";
import { filterAndSortKnowledge } from "../lib/knowledge";
import type { Filters, Knowledge, SortState } from "../types";

export function useFilteredKnowledge(
  knowledge: Knowledge[],
  filters: Filters,
  sort: SortState,
) {
  return useMemo(
    () => filterAndSortKnowledge(knowledge, filters, sort),
    [knowledge, filters, sort],
  );
}
