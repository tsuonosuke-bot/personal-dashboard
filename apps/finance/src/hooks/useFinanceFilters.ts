import { useMemo, useState } from 'react'
import { categoryLabel, currentMonthKey, filterExpensesByCategories, filterExpensesByPayer,
  monthKey, monthLabel, summarizeUnclassified, UNCLASSIFIED_CATEGORY, type CategoryFilterMode } from '../lib/finance'
import type { BudgetCategory, Expense } from '../lib/types'

/** 集計と明細で共有する、月・カテゴリ・支払者の条件。 */
export function useFinanceFilters(expenses: Expense[], categories: BudgetCategory[]) {
  const [requestedMonth, setRequestedMonth] = useState(currentMonthKey())
  const [requestedCategories, setRequestedCategories] = useState<string[]>([])
  const [categoryMode, setCategoryMode] = useState<CategoryFilterMode>('include')
  const [requestedPayer, setRequestedPayer] = useState('')
  const availableMonths = useMemo(
    () => Array.from(new Set(expenses.map((expense) => monthKey(expense.transaction_date)))).sort().reverse(),
    [expenses],
  )
  const availableCategories = useMemo(
    () => Array.from(new Set([
      ...categories.map((category) => category.name),
      ...expenses.map((expense) => expense.category),
    ])).sort(),
    [categories, expenses],
  )
  const availablePayers = useMemo(
    () => Array.from(new Set(
      expenses.map((expense) => expense.payer).filter((payer): payer is string => Boolean(payer)),
    )).sort((left, right) => left.localeCompare(right, 'ja')),
    [expenses],
  )
  const selectedMonth = availableMonths.includes(requestedMonth)
    ? requestedMonth
    : (availableMonths[0] ?? requestedMonth)
  const selectedCategories = useMemo(
    () => requestedCategories.filter((category) => availableCategories.includes(category)),
    [availableCategories, requestedCategories],
  )
  const selectedCategorySummary = useMemo(() => {
    if (selectedCategories.length === 0) return ''
    if (selectedCategories.length === availableCategories.length) return 'すべてのカテゴリ'
    const labels = selectedCategories.map(categoryLabel)
    if (labels.length <= 2) return labels.join('、')
    return `${labels.slice(0, 2).join('、')} ほか${labels.length - 2}件`
  }, [availableCategories.length, selectedCategories])
  const selectedPayer = availablePayers.includes(requestedPayer) ? requestedPayer : ''
  const filteredExpenses = useMemo(
    () => filterExpensesByPayer(
      filterExpensesByCategories(expenses, selectedCategories, categoryMode),
      selectedPayer,
    ),
    [expenses, selectedCategories, categoryMode, selectedPayer],
  )
  const unclassified = useMemo(() => summarizeUnclassified(expenses), [expenses])
  const unclassifiedMonthNote = unclassified.months.length > 1
    ? `${monthLabel(unclassified.months[0])} ほか${unclassified.months.length - 1}ヶ月`
    : unclassified.months.map(monthLabel).join('')
  const selectedMonthIndex = availableMonths.indexOf(selectedMonth)
  const newestTransaction = expenses.reduce(
    (latest, expense) => expense.transaction_date > latest ? expense.transaction_date : latest,
    '',
  )

  // 未分類だけを一覧・グラフに残し、明細が最も新しい月へ移動する。
  const focusUnclassified = () => {
    setRequestedCategories([UNCLASSIFIED_CATEGORY])
    setCategoryMode('include')
    setRequestedPayer('')
    if (unclassified.months.length > 0) setRequestedMonth(unclassified.months[0])
  }

  const toggleCategory = (category: string) => {
    setRequestedCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category])
  }

  return { setRequestedMonth, setRequestedCategories, categoryMode, setCategoryMode, setRequestedPayer,
    availableMonths, availableCategories, availablePayers, selectedMonth, selectedCategories, selectedCategorySummary,
    selectedPayer, filteredExpenses, unclassified, unclassifiedMonthNote, selectedMonthIndex, newestTransaction,
    focusUnclassified, toggleCategory }
}
export type FinanceFilters = ReturnType<typeof useFinanceFilters>
