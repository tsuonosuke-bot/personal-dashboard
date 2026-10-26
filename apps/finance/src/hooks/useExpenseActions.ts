import { useState, type Dispatch, type SetStateAction } from 'react'
import { ApiError } from '../lib/api'
import { monthKey } from '../lib/finance'
import type { Expense, ExpenseDraft } from '../lib/types'
import type { BulkCategoryResult } from '../components/BulkCategoryBar'
import type { useExpenses } from './useExpenses'

type Options = {
  data: Pick<ReturnType<typeof useExpenses>, 'createExpense' | 'updateExpense' | 'setVoided'>
  setRequestedMonth: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string | null>>
}
/** 保存・取消・復元・一括分類の操作結果を管理する。 */
export function useExpenseActions({ data, setRequestedMonth, setNotice }: Options) {
  const { createExpense, updateExpense, setVoided } = data
  const [entryOpen, setEntryOpen] = useState(() => new URLSearchParams(window.location.search).get('new') === 'expense')
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const closeEntry = () => {
    setEntryOpen(false)
    setEditingExpense(null)
    setActionError(null)
    if (new URLSearchParams(window.location.search).has('new')) window.history.replaceState(null, '', window.location.pathname)
  }

  const saveExpense = async (draft: ExpenseDraft) => {
    setActionError(null)
    try {
      const saved = editingExpense
        ? await updateExpense(editingExpense, draft)
        : await createExpense(draft)
      setRequestedMonth(monthKey(saved.transaction_date))
      setNotice(editingExpense ? '家計簿を更新しました。' : '家計簿に保存しました。')
      closeEntry()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '家計簿を保存できませんでした。')
    }
  }

  const voidExpense = async () => {
    if (!editingExpense) return
    const generated = /定期登録 #\d+/.test(editingExpense.memo ?? '')
    const message = `「${editingExpense.title}」（${editingExpense.transaction_date}）を取り消しますか？\n集計とCSVから外れます。明細一覧の「取消済み」からいつでも復元できます。${generated ? '\n定期登録で作られた明細です。取り消しても同じ日の分は再生成されません。' : ''}`
    if (!window.confirm(message)) return
    setActionError(null)
    try {
      await setVoided(editingExpense, true)
      setNotice('明細を取り消しました。明細一覧の「取消済み」から復元できます。')
      closeEntry()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '明細を取り消せませんでした。')
    }
  }

  const restoreExpense = async (expense: Expense) => {
    setActionError(null)
    try {
      await setVoided(expense, false)
      setNotice(`「${expense.title}」を復元しました。`)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '明細を復元できませんでした。')
    }
  }

  // 未分類の明細を1件ずつ編集APIで更新する。編集前の値を条件にするので、他画面で変わった行は409で止まり上書きしない。
  const bulkCategorize = async (targets: Expense[], category: string, hooks: { shouldStop: () => boolean; onProgress: (done: number) => void }) => {
    const result: BulkCategoryResult = { updated: [], conflicts: [], failed: [], skipped: [] }
    for (const [index, expense] of targets.entries()) {
      if (hooks.shouldStop()) {
        result.skipped.push(expense.id)
        continue
      }
      const amount = Number(expense.amount)
      try {
        await updateExpense(expense, {
          transaction_date: expense.transaction_date,
          amount: Math.abs(amount),
          title: expense.title,
          category,
          payer: expense.payer,
          memo: expense.memo,
          type: amount < 0 ? 'offset' : 'expense',
        })
        result.updated.push(expense.id)
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) result.conflicts.push(expense.id)
        else result.failed.push(expense.id)
      }
      hooks.onProgress(index + 1)
    }
    return result
  }

  return { entryOpen, setEntryOpen, editingExpense, setEditingExpense, actionError, setActionError,
    closeEntry, saveExpense, voidExpense, restoreExpense, bulkCategorize }
}
