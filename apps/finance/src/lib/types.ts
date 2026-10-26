import type { Tables } from '../../../../packages/database-types/database.types'

export type BudgetCategory = Pick<Tables<'budget_categories'>, 'id' | 'name' | 'notion_url'>

/** The API normalizes a nullable DB title to an empty string. */
export type Expense = Pick<Tables<'expenses'>,
  | 'id' | 'transaction_date' | 'amount' | 'category' | 'payer' | 'memo'
  | 'notion_url' | 'notion_created_at' | 'created_at' | 'voided_at'
> & { title: string }

export type ExpenseDraft = {
  transaction_date: string
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
  type: 'expense' | 'income' | 'offset'
}

export type ExpenseSnapshot = Pick<Expense,
  'transaction_date' | 'amount' | 'title' | 'category' | 'payer' | 'memo'
>

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly'

export type RecurringExpense = Pick<Tables<'recurring_expenses'>,
  | 'id' | 'source_expense_id' | 'template_rule_id' | 'interval_count' | 'day_of_month'
  | 'start_date' | 'end_date' | 'next_run_date' | 'active' | 'amount' | 'title'
  | 'category' | 'payer' | 'memo' | 'last_generated_at' | 'created_at' | 'updated_at'
> & { frequency: RecurringFrequency }

export type RecurringExpenseDraft = {
  template_rule_id: number | null
  start_date: string
  frequency: RecurringFrequency
  interval_count: number
  end_date: string | null
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
  type: 'expense' | 'income' | 'offset'
}

export type RecurringExpenseUpdate = {
  id: number
  frequency: RecurringFrequency
  interval_count: number
  end_date: string | null
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
  type: 'expense' | 'income' | 'offset'
}
