import { ALL, MASTERY_ORDER } from "../constants";
import type { Filters } from "../types";

interface Props {
  filters: Filters;
  categories: string[];
  resultCount: number;
  onChange: (patch: Partial<Filters>) => void;
}

export function FilterBar({ filters, categories, resultCount, onChange }: Props) {
  return (
    <div className="card filters">
      <input
        type="text"
        placeholder="🔍 タイトル・説明・タグで検索"
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <select value={filters.category} onChange={(e) => onChange({ category: e.target.value })}>
        {[ALL, ...categories].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select value={filters.mastery} onChange={(e) => onChange({ mastery: e.target.value })}>
        {[ALL, ...MASTERY_ORDER].map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <span className="count">{resultCount}件</span>
    </div>
  );
}
