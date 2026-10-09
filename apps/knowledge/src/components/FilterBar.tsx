import { ALL, MASTERY_ORDER, PRIORITY_ORDER } from "../constants";
import type { Filters } from "../types";

interface Props {
  filters: Filters;
  categories: string[];
  resultCount: number;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}

const REVIEW_LABELS: Record<Filters["review"], string> = {
  all: "すべて",
  due: "本日まで",
  today: "本日",
  overdue: "期限超過",
};

/** 既定から変えている条件。チップで示し、1つずつ外せるようにする（#136）。 */
function activeConditions(filters: Filters): { key: keyof Filters; label: string; reset: Partial<Filters> }[] {
  const items: { key: keyof Filters; label: string; reset: Partial<Filters> }[] = [];
  if (filters.search) items.push({ key: "search", label: `検索: ${filters.search}`, reset: { search: "" } });
  if (filters.category !== ALL) items.push({ key: "category", label: `カテゴリ: ${filters.category}`, reset: { category: ALL } });
  if (filters.mastery !== ALL) items.push({ key: "mastery", label: `習熟度: ${filters.mastery}`, reset: { mastery: ALL } });
  if (filters.priority !== ALL) items.push({ key: "priority", label: `優先度: ${filters.priority}`, reset: { priority: ALL } });
  if (filters.review !== "all") items.push({ key: "review", label: `復習日: ${REVIEW_LABELS[filters.review]}`, reset: { review: "all" } });
  return items;
}

export function FilterBar({ filters, categories, resultCount, onChange, onClear }: Props) {
  const active = activeConditions(filters);
  // URLから復元したカテゴリが一覧に無くても、選択中の値として表示できるようにする
  const categoryOptions = categories.includes(filters.category) || filters.category === ALL ? categories : [...categories, filters.category];
  return (
    <div className="card filters" role="search" aria-label="ナレッジの絞り込み">
      <label className="filter-field filter-field-search">
        <span>検索</span>
        <input
          type="text"
          placeholder="タイトル・説明・タグ"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </label>
      <label className="filter-field">
        <span>カテゴリ</span>
        <select value={filters.category} onChange={(e) => onChange({ category: e.target.value })}>
          {[ALL, ...categoryOptions].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>習熟度</span>
        <select value={filters.mastery} onChange={(e) => onChange({ mastery: e.target.value })}>
          {[ALL, ...MASTERY_ORDER].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>優先度</span>
        <select value={filters.priority} onChange={(e) => onChange({ priority: e.target.value })}>
          <option value={ALL}>{ALL}</option>
          {PRIORITY_ORDER.map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>復習日</span>
        <select value={filters.review} onChange={(e) => onChange({ review: e.target.value as Filters["review"] })}>
          {(Object.keys(REVIEW_LABELS) as Filters["review"][]).map((review) => (
            <option key={review} value={review}>{REVIEW_LABELS[review]}</option>
          ))}
        </select>
      </label>
      <span className="count" aria-live="polite">{resultCount}件</span>
      {active.length > 0 && (
        <div className="filter-chips" aria-label="適用中の条件">
          {active.map((item) => (
            <button
              key={item.key}
              type="button"
              className="filter-chip"
              aria-label={`${item.label} の条件を外す`}
              onClick={() => onChange(item.reset)}
            >
              <span>{item.label}</span><span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="filter-clear" onClick={onClear}>条件をクリア</button>
        </div>
      )}
    </div>
  );
}
