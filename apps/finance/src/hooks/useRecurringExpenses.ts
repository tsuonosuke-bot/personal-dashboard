import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { createRecurringExpense, getRecurringExpenses, runRecurringExpenses, setRecurringExpenseActive, updateRecurringExpense } from '../lib/api'
import type { RecurringExpense, RecurringExpenseDraft, RecurringExpenseUpdate } from '../lib/types'

type Options = { demoMode: boolean; reload: () => void; setNotice: Dispatch<SetStateAction<string | null>> }
/** 定期ルールの取得・編集と、その画面のURLを管理する。 */
export function useRecurringExpenses({ demoMode, reload, setNotice }: Options) {
  const [recurringOpen, setRecurringOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'recurring')
  const [recurringRules, setRecurringRules] = useState<RecurringExpense[]>([])
  const [recurringBusy, setRecurringBusy] = useState(false)
  const [recurringError, setRecurringError] = useState<string | null>(null)
  const [recurringLoadError, setRecurringLoadError] = useState<string | null>(null)

  const loadRecurringRules = useCallback(async () => {
    if (demoMode) return
    try {
      const rules = await getRecurringExpenses()
      setRecurringRules(rules)
      setRecurringLoadError(null)
      setRecurringError(null)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '定期登録を読み込めませんでした。'
      setRecurringLoadError(message)
      setRecurringError(message)
    }
  }, [demoMode])

  // Initial server data must be synchronized after mount; the async loader also backs the visible retry action.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadRecurringRules() }, [loadRecurringRules])
  useEffect(() => {
    const syncView = () => setRecurringOpen(new URLSearchParams(window.location.search).get('view') === 'recurring')
    window.addEventListener('popstate', syncView)
    return () => window.removeEventListener('popstate', syncView)
  }, [])
  const addRecurring = async (draft: RecurringExpenseDraft) => {
    setRecurringBusy(true); setRecurringError(null)
    try {
      const created = await createRecurringExpense(draft)
      setRecurringRules((current) => [...current, created])
      setNotice('定期登録ルールを追加しました。')
      return true
    } catch (caught) { setRecurringError(caught instanceof Error ? caught.message : '定期登録を追加できませんでした。'); return false }
    finally { setRecurringBusy(false) }
  }

  const toggleRecurring = async (rule: RecurringExpense) => {
    setRecurringBusy(true); setRecurringError(null)
    try {
      const updated = await setRecurringExpenseActive(rule.id, !rule.active)
      setRecurringRules((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (caught) { setRecurringError(caught instanceof Error ? caught.message : '定期登録を更新できませんでした。') }
    finally { setRecurringBusy(false) }
  }

  const editRecurring = async (draft: RecurringExpenseUpdate) => {
    setRecurringBusy(true); setRecurringError(null)
    try {
      const updated = await updateRecurringExpense(draft)
      setRecurringRules((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice('定期登録ルールを更新しました。')
      return true
    } catch (caught) { setRecurringError(caught instanceof Error ? caught.message : '定期登録を更新できませんでした。'); return false }
    finally { setRecurringBusy(false) }
  }

  const openRecurring = () => {
    setRecurringError(recurringLoadError)
    setRecurringOpen(true)
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'recurring')
    window.history.pushState(null, '', url)
  }

  const closeRecurring = () => {
    if (recurringBusy) return
    setRecurringOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }

  const runRecurring = async () => {
    setRecurringBusy(true); setRecurringError(null)
    try {
      const generated = await runRecurringExpenses()
      setRecurringRules(await getRecurringExpenses())
      setRecurringLoadError(null)
      reload()
      setNotice(generated > 0 ? `${generated}件の定期明細を登録しました。` : '登録が必要な定期明細はありませんでした。')
    } catch (caught) { setRecurringError(caught instanceof Error ? caught.message : '定期登録を実行できませんでした。') }
    finally { setRecurringBusy(false) }
  }

  return { recurringOpen, recurringRules, recurringBusy, recurringError, loadRecurringRules,
    addRecurring, toggleRecurring, editRecurring, openRecurring, closeRecurring, runRecurring }
}
