import { CategoryFilter } from './CategoryFilter'
import { monthLabel } from '../lib/finance'
import type { FinanceFilters } from '../hooks/useFinanceFilters'

export function FinanceFilterToolbar({ filters }: { filters: FinanceFilters }) {
  const { availableMonths, availableCategories, availablePayers, selectedMonth, selectedCategories, categoryMode,
    selectedPayer, selectedMonthIndex, selectedCategorySummary, setRequestedMonth, setCategoryMode,
    toggleCategory, setRequestedCategories, setRequestedPayer } = filters
  return <>
            <section className="month-toolbar" aria-label="表示条件の選択">
              <div className="filter-intro">
                <div className="filter-intro-title">
                  <p className="text-sm font-semibold text-slate-700">表示条件</p>
                </div>
              </div>
              <div className="filter-controls">
                <div>
                  <label className="toolbar-label" htmlFor="month-filter">月</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="month-nav-button"
                      disabled={selectedMonthIndex < 0 || selectedMonthIndex === availableMonths.length - 1}
                      onClick={() => setRequestedMonth(availableMonths[selectedMonthIndex + 1])}
                    >
                      ← 前月
                    </button>
                    <select
                      id="month-filter"
                      className="month-select"
                      value={selectedMonth}
                      onChange={(event) => setRequestedMonth(event.target.value)}
                    >
                      {availableMonths.map((month) => (
                        <option key={month} value={month}>{monthLabel(month)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="month-nav-button"
                      disabled={selectedMonthIndex <= 0}
                      onClick={() => setRequestedMonth(availableMonths[selectedMonthIndex - 1])}
                    >
                      翌月 →
                    </button>
                  </div>
                </div>
                <div>
                  <span className="toolbar-label">カテゴリ</span>
                  <CategoryFilter
                    categories={availableCategories}
                    selected={selectedCategories}
                    mode={categoryMode}
                    onModeChange={setCategoryMode}
                    onToggle={toggleCategory}
                    onSelectAll={() => setRequestedCategories(availableCategories)}
                    onClear={() => setRequestedCategories([])}
                  />
                </div>
                <div>
                  <label className="toolbar-label" htmlFor="payer-filter">支払者</label>
                  <select
                    id="payer-filter"
                    className="category-select"
                    value={selectedPayer}
                    onChange={(event) => setRequestedPayer(event.target.value)}
                  >
                    <option value="">すべての支払者</option>
                    {availablePayers.map((payer) => (
                      <option key={payer} value={payer}>{payer}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
            {(selectedCategories.length > 0 || selectedPayer) && (
              <div className="active-filter" role="status">
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {selectedCategories.length > 0 && (
                    <span>
                      {categoryMode === 'include' ? '含める' : '除外する'}カテゴリ: {selectedCategorySummary}
                    </span>
                  )}
                  {selectedPayer && <span>支払者: {selectedPayer}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRequestedCategories([])
                    setCategoryMode('include')
                    setRequestedPayer('')
                  }}
                >
                  すべて解除
                </button>
              </div>
            )}
  </>
}
