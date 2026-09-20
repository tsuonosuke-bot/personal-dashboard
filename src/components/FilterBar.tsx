import { ALL, MASTERY_ORDER, PRIORITY_ORDER } from "../constants";
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
      <select aria-label="優先度" value={filters.priority} onChange={(e) => onChange({ priority: e.target.value })}>
        <option value={ALL}>優先度: すべて</option>
        {PRIORITY_ORDER.map((priority) => (
          <option key={priority} value={priority}>優先度: {priority}</option>
        ))}
      </select>
      <select
        aria-label="復習状況"
        value={filters.review}
        onChange={(e) => onChange({ review: e.target.value as Filters["review"] })}
      >
        <option value="all">復習日: すべて</option>
        <option value="due">本日まで</option>
        <option value="today">本日</option>
        <option value="overdue">期限超過</option>
      </select>
      <span className="count">{resultCount}件</span>
    </div>
  );
}
