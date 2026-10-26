import { parseBudgetCategory } from './apiValidation.ts'
import { filterExpensesByCategories, filterExpensesByPayer, isIncome, monthKey, shiftMonthKey, summarizeUnclassified, type CategoryFilterMode, type MonthlyTrendDatum } from './finance.ts'
import type { BudgetCategory, Expense } from './types'

export type FinanceScope = { month: string; categories: string[]; categoryMode: CategoryFilterMode; payer: string }
export type MonthlyAggregate = { month: string; category: string; spending: number; income: number; spendingCount: number }
export type FinanceMetadata = {
  months: string[]
  categories: string[]
  payers: string[]
  total: number
  newestTransaction: string | null
  unclassified: { count: number; months: string[] }
  voidedCount: number
}
/** 収入の入力が始まった月(2026-01)から選択月までの累計。選択月がそれより前なら null。 */
export const CUMULATIVE_SINCE_MONTH = '2026-01'
export type CumulativeTotals = { since: string; spending: number; income: number }
export type FinanceOverview = { selectedMonth: string; metadata: FinanceMetadata; categories: BudgetCategory[]; monthly: MonthlyAggregate[]; cumulative: CumulativeTotals | null }
export type TransactionFilters = {
  query: string; dateFrom: string; dateTo: string; type: 'all' | 'expense' | 'income'
  amountMin: string; amountMax: string; sort: 'newest' | 'oldest' | 'amount-desc' | 'amount-asc'
}
export type ExpensePage = { items: Expense[]; total: number | null; limit: number; offset: number }

export function scopeKey(scope: FinanceScope): string {
  return JSON.stringify([scope.month, [...scope.categories].sort(), scope.categoryMode, scope.payer])
}

export function scopeParams(scope: FinanceScope): URLSearchParams {
  const params = new URLSearchParams({ month: scope.month, category_mode: scope.categoryMode })
  scope.categories.forEach((category) => params.append('category', category))
  if (scope.payer) params.set('payer', scope.payer)
  return params
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseFinanceOverview(value: unknown): FinanceOverview {
  const invalid = () => new Error('APIから受信した家計簿の集計が正しくありません。')
  if (!record(value) || typeof value.selectedMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.selectedMonth)
    || !record(value.metadata) || !Array.isArray(value.categories) || !Array.isArray(value.monthly)) throw invalid()
  const m = value.metadata
  if (!strings(m.months) || !m.months.every((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    || !strings(m.categories) || !strings(m.payers) || !count(m.total) || !count(m.voidedCount)
    || (m.newestTransaction !== null && (typeof m.newestTransaction !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.newestTransaction)))
    || !record(m.unclassified) || !count(m.unclassified.count) || !strings(m.unclassified.months)) throw invalid()
  const monthly = value.monthly.map((row) => {
    if (!record(row) || typeof row.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)
      || typeof row.category !== 'string' || !finite(row.spending) || !finite(row.income) || row.income < 0 || !count(row.spendingCount)) throw invalid()
    return { month: row.month, category: row.category, spending: row.spending, income: row.income, spendingCount: row.spendingCount }
  })
  let cumulative: CumulativeTotals | null = null
  if (value.cumulative !== undefined && value.cumulative !== null) {
    const c = value.cumulative
    if (!record(c) || typeof c.since !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(c.since)
      || !finite(c.spending) || !finite(c.income) || c.income < 0) throw invalid()
    cumulative = { since: c.since, spending: c.spending, income: c.income }
  }
  return {
    selectedMonth: value.selectedMonth,
    metadata: { months: m.months, categories: m.categories, payers: m.payers, total: m.total,
      newestTransaction: m.newestTransaction as string | null, voidedCount: m.voidedCount,
      unclassified: { count: m.unclassified.count, months: m.unclassified.months } },
    categories: value.categories.map(parseBudgetCategory), monthly, cumulative,
  }
}

export function summaryFromAggregates(monthly: MonthlyAggregate[], selectedMonth: string) {
  const previousMonth = shiftMonthKey(selectedMonth, -1)
  let spending = 0, income = 0, previousMonthSpending = 0, previousMonthIncome = 0
  for (const row of monthly) {
    if (row.month === selectedMonth) { spending += row.spending; income += row.income }
    if (row.month === previousMonth) { previousMonthSpending += row.spending; previousMonthIncome += row.income }
  }
  const balance = income - spending
  const previousMonthBalance = previousMonthIncome - previousMonthSpending
  return { selectedMonth, spending, income, balance, previousMonthSpending, previousMonthIncome,
    previousMonthBalance, balanceDiff: balance - previousMonthBalance }
}

export function trendFromAggregates(monthly: MonthlyAggregate[], selectedMonth: string) {
  const months = Array.from({ length: 12 }, (_, index) => shiftMonthKey(selectedMonth, index - 11))
  const visible = new Set(months)
  const categories = [...new Set(monthly.filter((row) => visible.has(row.month) && row.spendingCount > 0).map((row) => row.category))].sort()
  const byMonth = new Map<string, MonthlyTrendDatum>(months.map((month) => [month, { month, income: 0, balance: 0 }]))
  for (const row of monthly) {
    const item = byMonth.get(row.month)
    if (!item) continue
    item.income = Number(item.income) + row.income
    item.balance = Number(item.balance) + row.income - row.spending
    if (row.spending !== 0) item[row.category] = Number(item[row.category] ?? 0) + row.spending
  }
  return { categories, data: months.map((month) => byMonth.get(month)!) }
}

export function demoFinanceOverview(all: Expense[], categories: BudgetCategory[], scope: FinanceScope): FinanceOverview {
  const active = all.filter((expense) => !expense.voided_at)
  const months = [...new Set(active.map((expense) => monthKey(expense.transaction_date)))].sort().reverse()
  const selectedMonth = months.includes(scope.month) ? scope.month : months[0] ?? scope.month
  const scoped = filterExpensesByPayer(filterExpensesByCategories(active, scope.categories, scope.categoryMode), scope.payer)
  const start = shiftMonthKey(selectedMonth, -11)
  const totals = new Map<string, MonthlyAggregate>()
  for (const expense of scoped) {
    const month = monthKey(expense.transaction_date)
    if (month < start || month > selectedMonth) continue
    const key = JSON.stringify([month, expense.category])
    const row = totals.get(key) ?? { month, category: expense.category, spending: 0, income: 0, spendingCount: 0 }
    if (isIncome(expense)) row.income += Math.abs(expense.amount)
    else { row.spending += expense.amount; if (expense.amount !== 0) row.spendingCount += 1 }
    totals.set(key, row)
  }
  let cumulative: CumulativeTotals | null = null
  if (selectedMonth >= CUMULATIVE_SINCE_MONTH) {
    cumulative = { since: CUMULATIVE_SINCE_MONTH, spending: 0, income: 0 }
    for (const expense of scoped) {
      const month = monthKey(expense.transaction_date)
      if (month < CUMULATIVE_SINCE_MONTH || month > selectedMonth) continue
      if (isIncome(expense)) cumulative.income += Math.abs(expense.amount)
      else cumulative.spending += expense.amount
    }
  }
  return { selectedMonth, categories, monthly: [...totals.values()], cumulative, metadata: {
    months, categories: [...new Set(active.map((row) => row.category))],
    payers: [...new Set(active.map((row) => row.payer).filter((payer): payer is string => Boolean(payer)))],
    total: active.length, newestTransaction: active.reduce((latest, row) => row.transaction_date > latest ? row.transaction_date : latest, '') || null,
    unclassified: summarizeUnclassified(active), voidedCount: all.filter((row) => row.voided_at && monthKey(row.transaction_date) === selectedMonth).length,
  } }
}
