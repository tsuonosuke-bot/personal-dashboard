import { useEffect, useMemo, useState } from 'react'
import { categoryLabel, monthKey, monthLabel, UNCLASSIFIED_CATEGORY } from '../lib/finance'
import { scopeKey as getScopeKey, type FinanceScope } from '../lib/financeOverview'
import { emptyTransactionFilters, matchingExpenses } from '../lib/expensePaging'
import { useExpensePage } from '../hooks/useExpensePage'
import type { BudgetCategory, Expense } from '../lib/types'
import { BulkCategoryBar, type BulkCategoryResult } from './BulkCategoryBar'
import { TransactionAmount } from './TransactionAmount'

type Props = {
  scope: FinanceScope
  revision: number
  demoExpenses?: Expense[]
  onEdit?: (expense: Expense) => void
  /** 渡すと未分類の行を複数選択してカテゴリを一括変更できる */
  categories?: BudgetCategory[]
  onBulkCategorize?: (targets: Expense[], category: string, hooks: { shouldStop: () => boolean; onProgress: (done: number) => void }) => Promise<BulkCategoryResult>
  bulkBusy?: boolean
  voidedCount: number
  onRestore?: (expense: Expense) => void
  restoring?: boolean
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '/')
}

export function ExpenseTable({ scope, revision, demoExpenses, onEdit, categories = [], onBulkCategorize, bulkBusy = false, voidedCount, onRestore, restoring = false }: Props) {
  const selectedMonth = scope.month
  const scopeKey = getScopeKey(scope)
  const pageSize = 50
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'expense' | 'income'>('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'amount-desc' | 'amount-asc'>('newest')
  const [page, setPage] = useState(1)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selected, setSelected] = useState<ReadonlyMap<number, Expense>>(new Map())
  const [voidedOpen, setVoidedOpen] = useState(false)
  const [voidedPage, setVoidedPage] = useState(1)
  const [scopeNotice, setScopeNotice] = useState<string | null>(null)
  const [previousScope, setPreviousScope] = useState({ key: scopeKey, month: selectedMonth })

  // 集計条件が変わったら、検索・種別・金額・並び順は残し、表示月の外を指す期間だけを外す。
  if (previousScope.key !== scopeKey || previousScope.month !== selectedMonth) {
    setPreviousScope({ key: scopeKey, month: selectedMonth })
    setPage(1)
    setVoidedPage(1)
    if (previousScope.month !== selectedMonth) {
      const fromOutside = Boolean(dateFrom) && monthKey(dateFrom) !== selectedMonth
      const toOutside = Boolean(dateTo) && monthKey(dateTo) !== selectedMonth
      if (fromOutside || toOutside) {
        const label = `${dateFrom ? shortDate(dateFrom) : ''}〜${dateTo ? shortDate(dateTo) : ''}`
        if (fromOutside) setDateFrom('')
        if (toOutside) setDateTo('')
        setScopeNotice(`表示月を${monthLabel(selectedMonth)}に変えたため、月の外を指していた期間（${label}）を解除しました。`)
      } else {
        setScopeNotice(null)
      }
    }
  }

  const transactionFilters = useMemo(() => ({ dateFrom, dateTo, type, amountMin, amountMax, query, sort }),
    [dateFrom, dateTo, type, amountMin, amountMax, query, sort])
  const resultPage = useExpensePage(scope, transactionFilters, page, revision, demoExpenses)
  const voidedScope = useMemo(() => ({ month: selectedMonth, categories: [], categoryMode: 'include' as const, payer: '' }), [selectedMonth])
  const voidedResult = useExpensePage(voidedScope, emptyTransactionFilters, voidedPage, revision, demoExpenses, true, voidedOpen)
  const visibleRows = resultPage.items
  const total = resultPage.total
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = page
  useEffect(() => {
    if (!resultPage.loading && !resultPage.error && page > pageCount) setPage(pageCount)
  }, [resultPage.loading, resultPage.error, page, pageCount])
  useEffect(() => {
    const count = Math.max(1, Math.ceil(voidedResult.total / pageSize))
    if (voidedOpen && !voidedResult.loading && !voidedResult.error && voidedPage > count) setVoidedPage(count)
  }, [voidedOpen, voidedResult.loading, voidedResult.error, voidedResult.total, voidedPage])
  useEffect(() => {
    if (resultPage.loading || resultPage.error) return
    setSelected((current) => {
      let changed = false
      const next = new Map(current)
      for (const row of visibleRows) {
        if (!next.has(row.id)) continue
        if (row.category !== UNCLASSIFIED_CATEGORY || row.voided_at) { next.delete(row.id); changed = true }
        else if (JSON.stringify(next.get(row.id)) !== JSON.stringify(row)) { next.set(row.id, row); changed = true }
      }
      return changed ? next : current
    })
  }, [visibleRows, resultPage.loading, resultPage.error])

  // ページをまたいでも選択した明細と編集前の値を保持する。保存時のCASで変更競合を検出する。
  const bulkEnabled = Boolean(onBulkCategorize)
  const selectedRows = useMemo(() => matchingExpenses([...selected.values()], scope, transactionFilters)
    .filter((row) => row.category === UNCLASSIFIED_CATEGORY), [selected, scope, transactionFilters])
  const toggleSelected = (expense: Expense) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(expense.id)) next.delete(expense.id)
    else next.set(expense.id, expense)
    return next
  })
  const pageSelectable = visibleRows.filter((expense) => expense.category === UNCLASSIFIED_CATEGORY)
  const showSelect = bulkEnabled && (pageSelectable.length > 0 || selectedRows.length > 0)
  const pageAllSelected = pageSelectable.length > 0 && pageSelectable.every((expense) => selected.has(expense.id))
  const togglePage = () => setSelected((current) => {
    const next = new Map(current)
    for (const expense of pageSelectable) {
      if (pageAllSelected) next.delete(expense.id)
      else next.set(expense.id, expense)
    }
    return next
  })
  const finishBulk = (result: BulkCategoryResult) => setSelected((current) => {
    const remaining = new Set([...result.conflicts, ...result.failed, ...result.skipped])
    return new Map([...current].filter(([id]) => remaining.has(id)))
  })

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  const clearFilters = () => {
    setScopeNotice(null)
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
  // スマホで折りたたむ詳細条件（検索以外）のうち、既定から変えているものの数
  const activeDetailCount = [dateFrom, dateTo, type !== 'all', amountMin, amountMax, sort !== 'newest'].filter(Boolean).length

  const selectionInput = (expense: Expense) => expense.category === UNCLASSIFIED_CATEGORY && (
    <input type="checkbox" className="bulk-select" aria-label={`${expense.transaction_date} ${expense.title}を選択`}
      checked={selected.has(expense.id)} disabled={bulkBusy} onChange={() => toggleSelected(expense)} />
  )
  const pageSelectionInput = (
    <input type="checkbox" className="bulk-select" aria-label="このページの未分類をすべて選択"
      checked={pageAllSelected} disabled={pageSelectable.length === 0 || bulkBusy} onChange={togglePage} />
  )
  const editButton = (expense: Expense) => onEdit && (
    <button type="button" className="transaction-edit" aria-label={`${expense.title}を編集`} onClick={() => onEdit(expense)}>
      編集
    </button>
  )

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          
          <h2 className="panel-title">収支明細</h2>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-slate-500">{monthLabel(selectedMonth)}</p>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {resultPage.loading ? '読み込み中' : `${total.toLocaleString('ja-JP')}件`}
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
        <button
          type="button"
          className="filter-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls="transaction-filter-details"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span>詳細条件{activeDetailCount > 0 ? `（${activeDetailCount}件適用中）` : ''}</span><span aria-hidden="true">{detailsOpen ? '▲' : '▼'}</span>
        </button>
        <div id="transaction-filter-details" className="transaction-filter-details" data-open={detailsOpen}>
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
      </div>
      {scopeNotice && (
        <p className="filter-scope-notice" role="status">
          <span>{scopeNotice}</span>
          <button type="button" aria-label="お知らせを閉じる" onClick={() => setScopeNotice(null)}>×</button>
        </p>
      )}

      {onBulkCategorize && (
        <BulkCategoryBar
          selected={selectedRows}
          categories={categories}
          disabled={bulkBusy}
          onRun={onBulkCategorize}
          onFinished={finishBulk}
          onClearSelection={() => setSelected(new Map())}
        />
      )}
      <div className="transaction-results max-h-[34rem] overflow-auto rounded-xl border border-slate-200">
        <table className="transaction-table w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {showSelect && (
                <th className="w-10 px-3 py-3">
                  {pageSelectionInput}
                </th>
              )}
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
                {showSelect && (
                  <td className="w-10 px-3 py-3">
                    {selectionInput(expense)}
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{expense.transaction_date}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <TransactionAmount expense={expense} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{categoryLabel(expense.category)}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{expense.payer ?? '—'}</td>
                <td className="transaction-description px-4 py-3">
                  <p className="font-medium text-slate-800">{expense.title}</p>
                  {expense.memo && (
                    <p className="mt-0.5 max-w-xl truncate text-xs text-slate-500" title={expense.memo}>{expense.memo}</p>
                  )}
                </td>
                {onEdit && (
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {editButton(expense)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="transaction-mobile">
          {showSelect && <label className="transaction-page-selection">{pageSelectionInput}<span>このページの未分類をすべて選択</span></label>}
          <ul className="transaction-cards" aria-label="収支明細">
            {visibleRows.map((expense) => (
              <li key={expense.id} className="transaction-card">
                <div className="transaction-card-top">
                  <time dateTime={expense.transaction_date}>{expense.transaction_date}</time>
                  <TransactionAmount expense={expense} />
                </div>
                <h3 className="transaction-card-title">{expense.title}</h3>
                <dl className="transaction-card-meta">
                  <div><dt>カテゴリ</dt><dd>{categoryLabel(expense.category)}</dd></div>
                  <div><dt>支払者</dt><dd>{expense.payer ?? '—'}</dd></div>
                </dl>
                {expense.memo && <p className="transaction-card-memo" title={expense.memo}>{expense.memo}</p>}
                {(onEdit || (showSelect && expense.category === UNCLASSIFIED_CATEGORY)) && (
                  <div className="transaction-card-actions">
                    {showSelect && expense.category === UNCLASSIFIED_CATEGORY && <label>{selectionInput(expense)}<span>一括変更に選択</span></label>}
                    {editButton(expense)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        {resultPage.loading && <p role="status">明細を読み込んでいます…</p>}
        {resultPage.error && <p role="alert">{resultPage.error} <button type="button" onClick={resultPage.reload}>再試行</button></p>}
        {!resultPage.loading && !resultPage.error && total === 0 && (
          <div className="grid h-32 place-items-center bg-white text-sm text-slate-500">条件に一致する明細はありません</div>
        )}
      </div>
      {onRestore && (voidedCount > 0 || voidedOpen) && (
        <details className="voided-expenses" open={voidedOpen} onToggle={(event) => setVoidedOpen(event.currentTarget.open)}>
          <summary>取消済みの明細 {voidedCount.toLocaleString('ja-JP')}件（{monthLabel(selectedMonth)}）</summary>
          {voidedResult.loading && <p role="status">取消済みの明細を読み込んでいます…</p>}
          {voidedResult.error && <p role="alert">{voidedResult.error} <button type="button" onClick={voidedResult.reload}>再試行</button></p>}
          {!voidedResult.loading && !voidedResult.error && voidedResult.total === 0 && <p>取消済みの明細はありません。</p>}
          <ul>
            {voidedResult.items.map((expense) => (
              <li key={expense.id}>
                <span>{expense.transaction_date}</span>
                <strong>{expense.title}</strong>
                <TransactionAmount expense={expense} />
                <small>取消 {new Date(expense.voided_at ?? '').toLocaleString('ja-JP')}</small>
                <button type="button" onClick={() => onRestore(expense)} disabled={restoring} aria-label={`${expense.title}を復元`}>復元</button>
              </li>
            ))}
          </ul>
          {voidedResult.total > pageSize && <div className="flex items-center gap-2">
            <button type="button" className="pagination-button" disabled={voidedPage === 1 || voidedResult.loading} onClick={() => setVoidedPage((p) => p - 1)}>前へ</button>
            <span>{voidedPage} / {Math.max(1, Math.ceil(voidedResult.total / pageSize))}</span>
            <button type="button" className="pagination-button" disabled={voidedPage * pageSize >= voidedResult.total || voidedResult.loading} onClick={() => setVoidedPage((p) => p + 1)}>次へ</button>
          </div>}
        </details>
      )}
      {!resultPage.error && total > 0 && (
        <div className="mt-4 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, total)}件を表示
            <span className="ml-1 text-slate-400">/ 全{total.toLocaleString('ja-JP')}件</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="pagination-button"
              disabled={currentPage === 1 || resultPage.loading}
              onClick={() => setPage(currentPage - 1)}
            >
              前へ
            </button>
            <span className="min-w-20 text-center text-xs font-semibold text-slate-600">{currentPage} / {pageCount}</span>
            <button
              type="button"
              className="pagination-button"
              disabled={currentPage >= pageCount || resultPage.loading}
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
