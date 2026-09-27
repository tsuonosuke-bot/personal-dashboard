import { useMemo, useState } from 'react'
import { categoryLabel, isIncome, monthKey, monthLabel, yen } from '../lib/finance'
import type { Expense } from '../lib/types'

type Props = {
  expenses: Expense[]
  selectedMonth: string
  onEdit?: (expense: Expense) => void
}

export function ExpenseTable({ expenses, selectedMonth, onEdit }: Props) {
  const pageSize = 50
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'expense' | 'income'>('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'amount-desc' | 'amount-asc'>('newest')
  const [page, setPage] = useState(1)

  const monthExpenses = useMemo(
    () => expenses.filter((expense) => monthKey(expense.transaction_date) === selectedMonth),
    [expenses, selectedMonth],
  )

  const filtered = useMemo(() => monthExpenses.filter((expense) => {
    if (dateFrom && expense.transaction_date < dateFrom) return false
    if (dateTo && expense.transaction_date > dateTo) return false
    if (type === 'expense' && isIncome(expense)) return false
    if (type === 'income' && !isIncome(expense)) return false
    const absoluteAmount = Math.abs(Number(expense.amount))
    if (amountMin && absoluteAmount < Number(amountMin)) return false
    if (amountMax && absoluteAmount > Number(amountMax)) return false
    if (query) {
      const haystack = `${expense.title} ${expense.memo ?? ''} ${expense.category} ${expense.payer ?? ''}`.toLocaleLowerCase('ja')
      if (!haystack.includes(query.toLocaleLowerCase('ja'))) return false
    }
    return true
  }).sort((left, right) => {
    if (sort === 'oldest') return left.transaction_date.localeCompare(right.transaction_date) || left.id - right.id
    if (sort === 'amount-desc') return Math.abs(Number(right.amount)) - Math.abs(Number(left.amount)) || right.id - left.id
    if (sort === 'amount-asc') return Math.abs(Number(left.amount)) - Math.abs(Number(right.amount)) || right.id - left.id
    return right.transaction_date.localeCompare(left.transaction_date) || right.id - left.id
  }), [monthExpenses, dateFrom, dateTo, type, amountMin, amountMax, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filtered],
  )

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  const clearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setQuery('')
    setType('all')
    setAmountMin('')
    setAmountMax('')
    setSort('newest')
    setPage(1)
  }

  const hasFilters = Boolean(dateFrom || dateTo || query || type !== 'all' || amountMin || amountMax || sort !== 'newest')

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Transactions</p>
          <h2 className="panel-title">収支明細</h2>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-slate-500">{monthLabel(selectedMonth)}</p>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {filtered.length.toLocaleString('ja-JP')}件
          </span>
        </div>
      </div>

      <div className="transaction-filters">
        <input
          type="search"
          className="filter-control filter-search"
          placeholder="内容・メモ・カテゴリ・支払者を検索"
          value={query}
          onChange={(event) => updateFilter(setQuery, event.target.value)}
        />
        <input type="date" aria-label="開始日" className="filter-control" value={dateFrom} onChange={(event) => updateFilter(setDateFrom, event.target.value)} />
        <input type="date" aria-label="終了日" className="filter-control" value={dateTo} onChange={(event) => updateFilter(setDateTo, event.target.value)} />
        <select className="filter-control" aria-label="収支種別" value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1) }}>
          <option value="all">支出・収入すべて</option><option value="expense">支出のみ</option><option value="income">収入のみ</option>
        </select>
        <input type="number" min="0" step="1" inputMode="numeric" className="filter-control" placeholder="金額 下限" aria-label="金額の下限" value={amountMin} onChange={(event) => updateFilter(setAmountMin, event.target.value)} />
        <input type="number" min="0" step="1" inputMode="numeric" className="filter-control" placeholder="金額 上限" aria-label="金額の上限" value={amountMax} onChange={(event) => updateFilter(setAmountMax, event.target.value)} />
        <select className="filter-control" aria-label="並び順" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1) }}>
          <option value="newest">新しい順</option><option value="oldest">古い順</option><option value="amount-desc">金額が高い順</option><option value="amount-asc">金額が低い順</option>
        </select>
        <button type="button" className="filter-reset" onClick={clearFilters} disabled={!hasFilters}>条件をクリア</button>
      </div>

      <div className="max-h-[34rem] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">日付</th>
              <th className="px-4 py-3 text-right">金額</th>
              <th className="px-4 py-3">カテゴリ</th>
              <th className="px-4 py-3">支払者</th>
              <th className="px-4 py-3">内容</th>
              {onEdit && <th className="px-4 py-3 text-right">操作</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((expense) => (
              <tr key={expense.id} className="border-t border-slate-100 bg-white transition hover:bg-indigo-50/40">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{expense.transaction_date}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${isIncome(expense) ? 'text-sky-700' : 'text-slate-800'}`}>
                  {yen.format(Number(expense.amount))}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{categoryLabel(expense.category)}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{expense.payer ?? '—'}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{expense.title}</p>
                  {expense.memo && (
                    <p className="mt-0.5 max-w-xl truncate text-xs text-slate-500" title={expense.memo}>{expense.memo}</p>
                  )}
                </td>
                {onEdit && (
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
                      aria-label={`${expense.title}を編集`}
                      onClick={() => onEdit(expense)}
                    >
                      編集
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="grid h-32 place-items-center bg-white text-sm text-slate-500">条件に一致する明細はありません</div>
        )}
      </div>
      {filtered.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, filtered.length)}件を表示
            <span className="ml-1 text-slate-400">/ 全{filtered.length.toLocaleString('ja-JP')}件</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="pagination-button"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              前へ
            </button>
            <span className="min-w-20 text-center text-xs font-semibold text-slate-600">{currentPage} / {pageCount}</span>
            <button
              type="button"
              className="pagination-button"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
