import type { Expense } from './types'

export const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export function monthKey(date: string) {
  return date.slice(0, 7)
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function previousMonthKey(date = new Date()) {
  return currentMonthKey(new Date(date.getFullYear(), date.getMonth() - 1, 1))
}

export function shiftMonthKey(month: string, offset: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  return currentMonthKey(new Date(year, monthNumber - 1 + offset, 1))
}

export function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${year}年${monthNumber}月`
}

export function amountOf(expense: Expense) {
  return Number(expense.amount)
}

export function isIncome(expense: Expense) {
  return expense.category.startsWith('80_')
}

export function isSpending(expense: Expense) {
  return amountOf(expense) !== 0 && !isIncome(expense)
}

/** categoryが欠けた明細に充てる代替カテゴリ。 */
export const UNCLASSIFIED_CATEGORY = '97_未分類'

/** 未分類の明細の件数と、それが含まれる月を新しい順に返す。 */
export function summarizeUnclassified(expenses: Expense[]) {
  const months = new Set<string>()
  let count = 0
  for (const expense of expenses) {
    if (expense.category !== UNCLASSIFIED_CATEGORY) continue
    count += 1
    months.add(monthKey(expense.transaction_date))
  }
  return { count, months: Array.from(months).sort().reverse() }
}

export function categoryLabel(category: string) {
  return category.replace(/^\d+_/, '')
}

export type CategoryFilterMode = 'include' | 'exclude'

export function filterExpensesByCategories(
  expenses: Expense[],
  categories: string[],
  mode: CategoryFilterMode,
) {
  if (categories.length === 0) return expenses
  const selected = new Set(categories)
  return expenses.filter((expense) => mode === 'include'
    ? selected.has(expense.category)
    : !selected.has(expense.category))
}

export function filterExpensesByCategory(expenses: Expense[], category: string) {
  return filterExpensesByCategories(expenses, category ? [category] : [], 'include')
}

export function filterExpensesByPayer(expenses: Expense[], payer: string) {
  if (!payer) return expenses
  return expenses.filter((expense) => expense.payer === payer)
}

export type MonthlyTrendDatum = {
  month: string
  income: number
  balance: number
  [key: string]: string | number
}

export function buildMonthlyTrendData(expenses: Expense[], selectedMonth: string) {
  const months = Array.from({ length: 12 }, (_, index) => shiftMonthKey(selectedMonth, index - 11))
  const visibleMonths = new Set(months)
  const totals = new Map<string, {
    spending: number
    income: number
    spendingByCategory: Map<string, number>
  }>()
  const categorySet = new Set<string>()

  for (const expense of expenses) {
    const key = monthKey(expense.transaction_date)
    if (!visibleMonths.has(key)) continue
    const current = totals.get(key) ?? {
      spending: 0,
      income: 0,
      spendingByCategory: new Map<string, number>(),
    }

    if (isSpending(expense)) {
      const amount = amountOf(expense)
      current.spending += amount
      current.spendingByCategory.set(
        expense.category,
        (current.spendingByCategory.get(expense.category) ?? 0) + amount,
      )
      categorySet.add(expense.category)
    }
    if (isIncome(expense)) current.income += Math.abs(amountOf(expense))
    totals.set(key, current)
  }

  const categories = Array.from(categorySet).sort()
  const data = months.map((month) => {
    const current = totals.get(month)
    const row: MonthlyTrendDatum = {
      month,
      income: current?.income ?? 0,
      balance: (current?.income ?? 0) - (current?.spending ?? 0),
    }
    for (const category of categories) {
      const total = current?.spendingByCategory.get(category)
      if (total) row[category] = total
    }
    return row
  })

  return { categories, data }
}

export function summarizeMonth(expenses: Expense[], selectedMonth: string) {
  const previousMonth = shiftMonthKey(selectedMonth, -1)
  let spending = 0
  let income = 0
  let previousMonthSpending = 0
  let previousMonthIncome = 0

  for (const expense of expenses) {
    const key = monthKey(expense.transaction_date)
    if (key === selectedMonth && isSpending(expense)) spending += amountOf(expense)
    if (key === selectedMonth && isIncome(expense)) income += Math.abs(amountOf(expense))
    if (key === previousMonth && isSpending(expense)) previousMonthSpending += amountOf(expense)
    if (key === previousMonth && isIncome(expense)) previousMonthIncome += Math.abs(amountOf(expense))
  }

  const balance = income - spending
  const previousMonthBalance = previousMonthIncome - previousMonthSpending

  return {
    selectedMonth,
    spending,
    income,
    balance,
    previousMonthSpending,
    previousMonthIncome,
    previousMonthBalance,
    balanceDiff: balance - previousMonthBalance,
  }
}
