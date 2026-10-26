import { filterExpensesByCategories, filterExpensesByPayer, isIncome, monthKey } from './finance.ts'
import type { FinanceScope, TransactionFilters } from './financeOverview.ts'
import type { Expense } from './types'

export const emptyTransactionFilters: TransactionFilters = { query: '', dateFrom: '', dateTo: '',
  type: 'all', amountMin: '', amountMax: '', sort: 'newest' }

export function matchingExpenses(rows: Expense[], scope: FinanceScope, filters: TransactionFilters, voided = false): Expense[] {
  return filterExpensesByPayer(filterExpensesByCategories(rows, scope.categories, scope.categoryMode), scope.payer)
    .filter((expense) => {
      if (Boolean(expense.voided_at) !== voided || monthKey(expense.transaction_date) !== scope.month) return false
      if (filters.dateFrom && expense.transaction_date < filters.dateFrom) return false
      if (filters.dateTo && expense.transaction_date > filters.dateTo) return false
      if (filters.type === 'expense' && isIncome(expense)) return false
      if (filters.type === 'income' && !isIncome(expense)) return false
      const amount = Math.abs(Number(expense.amount))
      if (filters.amountMin && amount < Number(filters.amountMin)) return false
      if (filters.amountMax && amount > Number(filters.amountMax)) return false
      return !filters.query || `${expense.title} ${expense.memo ?? ''} ${expense.category} ${expense.payer ?? ''}`
        .toLocaleLowerCase('ja').includes(filters.query.toLocaleLowerCase('ja'))
    }).sort((left, right) => {
      if (filters.sort === 'oldest') return left.transaction_date.localeCompare(right.transaction_date) || left.id - right.id
      if (filters.sort === 'amount-desc') return Math.abs(right.amount) - Math.abs(left.amount) || right.id - left.id
      if (filters.sort === 'amount-asc') return Math.abs(left.amount) - Math.abs(right.amount) || right.id - left.id
      return right.transaction_date.localeCompare(left.transaction_date) || right.id - left.id
    })
}
