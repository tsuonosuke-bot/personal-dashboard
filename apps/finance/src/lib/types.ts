export type BudgetCategory = {
  id: number
  name: string
  notion_url: string | null
}

export type Expense = {
  id: number
  transaction_date: string
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
  notion_url: string | null
  notion_created_at: string | null
  created_at: string
}

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

export type RecurringExpense = {
  id: number
  source_expense_id: number | null
  template_rule_id: number | null
  frequency: RecurringFrequency
  interval_count: number
  day_of_month: number
  start_date: string
  end_date: string | null
  next_run_date: string
  active: boolean
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
  last_generated_at: string | null
  created_at: string
  updated_at: string
}

export type RecurringExpenseDraft = {
  template_rule_id: number
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
