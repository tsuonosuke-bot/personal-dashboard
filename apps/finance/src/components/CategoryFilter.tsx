import { categoryLabel, type CategoryFilterMode } from '../lib/finance'

type Props = {
  categories: string[]
  selected: string[]
  mode: CategoryFilterMode
  onModeChange: (mode: CategoryFilterMode) => void
  onToggle: (category: string) => void
  onSelectAll: () => void
  onClear: () => void
}

function summaryLabel(categories: string[], selected: string[], mode: CategoryFilterMode) {
  if (selected.length === 0) return 'すべてのカテゴリ'
  if (categories.length > 0 && selected.length === categories.length) {
    return `全カテゴリを${mode === 'include' ? '含む' : '除外'}`
  }
  if (selected.length === 1) return `${categoryLabel(selected[0])}を${mode === 'include' ? '含む' : '除外'}`
  return `${selected.length}カテゴリを${mode === 'include' ? '含む' : '除外'}`
}

export function CategoryFilter({ categories, selected, mode, onModeChange, onToggle, onSelectAll, onClear }: Props) {
  const allSelected = categories.length > 0 && selected.length === categories.length

  return (
    <details className="category-filter">
      <summary aria-label="カテゴリ条件を開く">
        <span>{summaryLabel(categories, selected, mode)}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="category-filter-popover">
        <div className="category-mode" role="group" aria-label="カテゴリの絞り込み方法">
          <button type="button" aria-pressed={mode === 'include'} className={mode === 'include' ? 'active' : ''} onClick={() => onModeChange('include')}>含める</button>
          <button type="button" aria-pressed={mode === 'exclude'} className={mode === 'exclude' ? 'active' : ''} onClick={() => onModeChange('exclude')}>除外する</button>
        </div>
        <p className="category-filter-help">チェックしたカテゴリを{mode === 'include' ? '表示します' : '一覧と集計から除きます'}</p>
        <div className="category-options">
          {categories.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                aria-label={categoryLabel(category)}
                checked={selected.includes(category)}
                onChange={() => onToggle(category)}
              />
              <span>{categoryLabel(category)}</span>
            </label>
          ))}
        </div>
        <div className="category-filter-footer">
          <span>{selected.length}/{categories.length}件選択</span>
          <div className="category-filter-actions" role="group" aria-label="カテゴリの一括操作">
            <button type="button" aria-label="カテゴリをすべて選択" onClick={onSelectAll} disabled={categories.length === 0 || allSelected}>すべて選択</button>
            <button type="button" aria-label="カテゴリの選択をすべて解除" onClick={onClear} disabled={selected.length === 0}>すべて解除</button>
          </div>
        </div>
      </div>
    </details>
  )
}
