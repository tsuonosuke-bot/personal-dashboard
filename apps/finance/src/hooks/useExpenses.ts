import { useCallback, useEffect, useState } from 'react'
import { createExpense as createExpenseApi, getBudgetCategories, getExpenses, updateExpense as updateExpenseApi } from '../lib/api'
import { createDemoExpenses, demoCategories } from '../lib/demoData'
import type { BudgetCategory, Expense, ExpenseDraft } from '../lib/types'

export function useExpenses() {
  const demoMode = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true'
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [mutating, setMutating] = useState(false)

  const reload = useCallback(() => setRequestId((id) => id + 1), [])

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      setLoading(true)
      setError(null)

      if (demoMode) {
        setExpenses(createDemoExpenses())
        setCategories(demoCategories)
        setLastUpdatedAt(new Date())
        setLoading(false)
        return
      }

      try {
        const [all, categoryData] = await Promise.all([getExpenses(), getBudgetCategories()])
        if (!cancelled) {
          setExpenses(all)
          setCategories(categoryData)
          setLastUpdatedAt(new Date())
          setLoading(false)
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'データを読み込めませんでした。')
          setLoading(false)
        }
      }
    }

    fetchAll()
    return () => {
      cancelled = true
    }
  }, [demoMode, requestId])

  const createExpense = useCallback(async (input: ExpenseDraft) => {
    if (demoMode) throw new Error('デモモードでは家計簿を保存できません。')
    setMutating(true)
    try {
      const created = await createExpenseApi(input)
      setExpenses((current) => [created, ...current])
      setLastUpdatedAt(new Date())
      return created
    } finally {
      setMutating(false)
    }
  }, [demoMode])

  const updateExpense = useCallback(async (original: Expense, input: ExpenseDraft) => {
    if (demoMode) throw new Error('デモモードでは家計簿を更新できません。')
    setMutating(true)
    try {
      const updated = await updateExpenseApi(original.id, input, {
        transaction_date: original.transaction_date,
        amount: original.amount,
        title: original.title,
        category: original.category,
        payer: original.payer,
        memo: original.memo,
      })
      setExpenses((current) => current.map((expense) => expense.id === updated.id ? updated : expense))
      setLastUpdatedAt(new Date())
      return updated
    } finally {
      setMutating(false)
    }
  }, [demoMode])

  return { expenses, categories, loading, error, lastUpdatedAt, reload, demoMode, mutating, createExpense, updateExpense }
}
