import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createExpense as createExpenseApi, getFinanceOverview, setExpenseVoided, updateExpense as updateExpenseApi } from '../lib/api'
import { createDemoExpenses, demoCategories } from '../lib/demoData'
import { demoFinanceOverview, scopeKey, type FinanceMetadata, type FinanceOverview } from '../lib/financeOverview'
import { monthKey } from '../lib/finance'
import type { BudgetCategory, Expense, ExpenseDraft } from '../lib/types'
import { useFinanceFilters } from './useFinanceFilters'

const emptyMetadata: FinanceMetadata = { months: [], categories: [], payers: [], total: 0,
  newestTransaction: null, unclassified: { count: 0, months: [] }, voidedCount: 0 }

export function useExpenses() {
  const demoMode = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true'
  const demoExpenses = useMemo(() => demoMode ? createDemoExpenses() : [], [demoMode])
  const [metadata, setMetadata] = useState<FinanceMetadata>(emptyMetadata)
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const filters = useFinanceFilters(metadata, categories)
  const categoryKey = JSON.stringify(filters.selectedCategories)
  const scope = useMemo(() => ({ month: filters.selectedMonth, categories: JSON.parse(categoryKey) as string[],
    categoryMode: filters.categoryMode, payer: filters.selectedPayer }),
  [filters.selectedMonth, categoryKey, filters.categoryMode, filters.selectedPayer])
  const key = scopeKey(scope)
  const [overview, setOverview] = useState<{ key: string; revision: number; value: FinanceOverview } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [revision, setRevision] = useState(0)
  const [mutating, setMutating] = useState(false)
  const loaded = useRef('')
  const reload = useCallback(() => setRevision((id) => id + 1), [])

  useEffect(() => {
    const target = `${revision}:${key}`
    if (loaded.current === target) return
    const controller = new AbortController()
    let cancelled = false
    setError(null)
    async function readOverview() {
      try {
        const value = demoMode ? demoFinanceOverview(demoExpenses, demoCategories, scope)
          : await getFinanceOverview(scope, controller.signal)
        if (cancelled) return
        const canonicalKey = scopeKey({ ...scope, month: value.selectedMonth })
        loaded.current = `${revision}:${canonicalKey}`
        setOverview({ key: canonicalKey, revision, value })
        setMetadata(value.metadata)
        setCategories(value.categories)
        setLastUpdatedAt(new Date())
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'データを読み込めませんでした。')
      }
    }
    void readOverview()
    return () => { cancelled = true; controller.abort() }
  }, [key, scope, revision, demoMode, demoExpenses])

  // 新しい月の登録後もその月を選べるよう、次の集計が届くまで選択肢を補う。
  const changed = useCallback((rows: Expense[]) => {
    setMetadata((current) => ({ ...current,
      months: [...new Set([...current.months, ...rows.filter((row) => !row.voided_at).map((row) => monthKey(row.transaction_date))])].sort().reverse(),
      categories: [...new Set([...current.categories, ...rows.map((row) => row.category)])],
      payers: [...new Set([...current.payers, ...rows.flatMap((row) => row.payer ? [row.payer] : [])])],
    }))
    setLastUpdatedAt(new Date())
    reload()
  }, [reload])

  const createExpense = useCallback(async (input: ExpenseDraft) => {
    if (demoMode) throw new Error('デモモードでは家計簿を保存できません。')
    setMutating(true)
    try { const created = await createExpenseApi(input); changed([created]); return created }
    finally { setMutating(false) }
  }, [demoMode, changed])
  const updateExpense = useCallback(async (original: Expense, input: ExpenseDraft) => {
    if (demoMode) throw new Error('デモモードでは家計簿を更新できません。')
    setMutating(true)
    try {
      const updated = await updateExpenseApi(original.id, input, {
        transaction_date: original.transaction_date, amount: original.amount, title: original.title,
        category: original.category, payer: original.payer, memo: original.memo,
      })
      changed([updated]); return updated
    } finally { setMutating(false) }
  }, [demoMode, changed])
  const setVoided = useCallback(async (expense: Expense, voided: boolean) => {
    if (demoMode) throw new Error('デモモードでは家計簿を更新できません。')
    setMutating(true)
    try { const updated = await setExpenseVoided(expense.id, voided); changed([updated]); return updated }
    finally { setMutating(false) }
  }, [demoMode, changed])

  const currentOverview = overview?.key === key && overview.revision === revision ? overview.value : null
  return { metadata, categories, filters, scope, overview: currentOverview,
    loading: !overview && !error, refreshing: !currentOverview,
    error, lastUpdatedAt, reload, demoMode, demoExpenses, revision, mutating, setMutating,
    changed, createExpense, updateExpense, setVoided }
}
