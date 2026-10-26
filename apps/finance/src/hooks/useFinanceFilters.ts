import { useMemo, useState } from 'react'
import { categoryLabel, currentMonthKey, monthLabel, UNCLASSIFIED_CATEGORY, type CategoryFilterMode } from '../lib/finance'
import type { BudgetCategory } from '../lib/types'
import type { FinanceMetadata } from '../lib/financeOverview'

/** 集計と明細で共有する、月・カテゴリ・支払者の条件。 */
export function useFinanceFilters(metadata: FinanceMetadata, categories: BudgetCategory[]) {
  const [requestedMonth, setRequestedMonth] = useState(currentMonthKey())
  const [requestedCategories, setRequestedCategories] = useState<string[]>([])
  const [categoryMode, setCategoryMode] = useState<CategoryFilterMode>('include')
  const [requestedPayer, setRequestedPayer] = useState('')
  const availableMonths = useMemo(
    () => metadata.months,
    [metadata.months],
  )
  const availableCategories = useMemo(
    () => Array.from(new Set([
      ...categories.map((category) => category.name),
      ...metadata.categories,
    ])).sort(),
    [categories, metadata.categories],
  )
  const availablePayers = useMemo(
    () => [...metadata.payers].sort((left, right) => left.localeCompare(right, 'ja')),
    [metadata.payers],
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
  const unclassified = metadata.unclassified
  const unclassifiedMonthNote = unclassified.months.length > 1
    ? `${monthLabel(unclassified.months[0])} ほか${unclassified.months.length - 1}ヶ月`
    : unclassified.months.map(monthLabel).join('')
  const selectedMonthIndex = availableMonths.indexOf(selectedMonth)
  const newestTransaction = metadata.newestTransaction

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
    selectedPayer, unclassified, unclassifiedMonthNote, selectedMonthIndex, newestTransaction,
    focusUnclassified, toggleCategory }
}
export type FinanceFilters = ReturnType<typeof useFinanceFilters>
