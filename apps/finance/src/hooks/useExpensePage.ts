import { useEffect, useMemo, useRef, useState } from 'react'
import { getExpensePage } from '../lib/api'
import { scopeKey, type FinanceScope, type TransactionFilters } from '../lib/financeOverview'
import { matchingExpenses } from '../lib/expensePaging'
import type { Expense } from '../lib/types'

/** 読むのは表示中の50件だけ。件数は同じ条件・更新世代の最初の要求で求める。 */
export function useExpensePage(scope: FinanceScope, filters: TransactionFilters, page: number, revision: number,
  demoExpenses?: Expense[], voided = false, enabled = true) {
  const key = JSON.stringify([scopeKey(scope), filters, revision, voided])
  const offset = (page - 1) * 50
  const knownCount = useRef<{ key: string; total: number } | null>(null)
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<{ key: string; offset: number; items: Expense[]; total: number; error: string | null } | null>(null)
  const local = useMemo(() => demoExpenses ? matchingExpenses(demoExpenses, scope, filters, voided) : null,
    [demoExpenses, scope, filters, voided])
  useEffect(() => {
    if (!enabled || local) return
    const controller = new AbortController()
    let cancelled = false
    const count = knownCount.current?.key !== key
    void getExpensePage(scope, filters, offset, count, voided, controller.signal).then((value) => {
      if (cancelled) return
      const total = value.total ?? (knownCount.current?.key === key ? knownCount.current.total : null)
      if (total === null) throw new Error('明細の総件数を取得できませんでした。')
      knownCount.current = { key, total }
      setData({ key, offset, items: value.items, total, error: null })
    }).catch((caught: unknown) => {
      if (!cancelled) setData({ key, offset, items: [], total: knownCount.current?.key === key ? knownCount.current.total : 0,
        error: caught instanceof Error ? caught.message : '明細を読み込めませんでした。' })
    })
    return () => { cancelled = true; controller.abort() }
  }, [key, scope, filters, offset, voided, enabled, local, retry])
  if (local) return { items: local.slice(offset, offset + 50), total: local.length, loading: false, error: null, reload: () => setRetry((n) => n + 1) }
  const current = data?.key === key && data.offset === offset ? data : null
  return { items: current?.items ?? [], total: current?.total ?? (data?.key === key ? data.total : 0),
    loading: enabled && !current, error: current?.error ?? null, reload: () => setRetry((n) => n + 1) }
}
