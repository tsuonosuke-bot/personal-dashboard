import { readAllPages } from './allPages.ts'
import type { BudgetCategory, Expense, ExpenseDraft, ExpenseSnapshot, RecurringExpense, RecurringExpenseDraft, RecurringExpenseUpdate } from './types'
import { parseBudgetCategory, parseExpense, parsePageEnvelope, parseRecurringExpense } from './apiValidation'
import { readApiResponse, responseMessage } from './http'
import { parseFinanceOverview, scopeParams, type ExpensePage, type FinanceOverview, type FinanceScope, type TransactionFilters } from './financeOverview.ts'

type ErrorBody = { error?: unknown }

/** APIが返したエラー。409（他画面での更新）を一括処理で見分けるためにstatusを持つ。 */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function appPath(path: string): string {
  if (typeof window === 'undefined') return path
  const basePath = new URL(import.meta.env.BASE_URL, window.location.href).pathname.replace(/\/$/, '')
  return `${basePath}${path}`
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(appPath(path), {
      credentials: 'same-origin',
      method: 'GET',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch {
    throw new Error('ネットワークへ接続できませんでした。通信状態を確認して再試行してください。')
  }
  const responseBody = await readApiResponse(response)
  if (!response.ok) {
    let message = responseMessage(response)
    if (typeof responseBody === 'object' && responseBody !== null) {
      const body = responseBody as ErrorBody
      if (typeof body.error === 'string') message = body.error
    }
    throw new ApiError(message, response.status)
  }
  return responseBody
}

function getAllPages<T>(path: string, parseItem: (value: unknown) => T): Promise<T[]> {
  return readAllPages(path, parseItem, requestJson)
}

// 復元できるように取消済みも取得する。集計に使う前に voided_at で分ける。
export function getExpenses(): Promise<Expense[]> {
  return getAllPages('/api/expenses?include_voided=1', parseExpense)
}

export function getBudgetCategories(): Promise<BudgetCategory[]> {
  return getAllPages('/api/budget-categories', parseBudgetCategory)
}

export function getRecurringExpenses(): Promise<RecurringExpense[]> {
  return getAllPages('/api/recurring-expenses', parseRecurringExpense)
}

export async function getFinanceOverview(scope: FinanceScope, signal?: AbortSignal): Promise<FinanceOverview> {
  return parseFinanceOverview(await requestJson(`/api/finance-overview?${scopeParams(scope)}`, { signal }))
}

export async function getExpensePage(scope: FinanceScope, filters: TransactionFilters, offset: number,
  count = true, voided = false, signal?: AbortSignal): Promise<ExpensePage> {
  const params = scopeParams(scope)
  params.set('limit', '50')
  params.set('offset', String(offset))
  params.set('count', count ? 'exact' : 'none')
  params.set('voided', voided ? '1' : '0')
  if (filters.query) params.set('q', filters.query)
  if (filters.dateFrom) params.set('from', filters.dateFrom)
  if (filters.dateTo) params.set('to', filters.dateTo)
  if (filters.amountMin) params.set('amount_min', filters.amountMin)
  if (filters.amountMax) params.set('amount_max', filters.amountMax)
  params.set('type', filters.type)
  params.set('sort', filters.sort)
  const page = parsePageEnvelope(await requestJson(`/api/expense-page?${params}`, { signal }))
  if (page.limit !== 50 || page.offset !== offset || page.items.length > 50) throw new Error('APIのページ情報が要求内容と一致しません。')
  return { ...page, items: page.items.map(parseExpense) }
}

export type BulkCategoryResponse = { id: number; status: 'updated' | 'conflict' | 'failed'; item?: Expense }
export async function categorizeExpenseBatch(targets: Expense[], category: string): Promise<BulkCategoryResponse[]> {
  const data = await requestJson('/api/expense-categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'expense-categories' },
    body: JSON.stringify({ category, items: targets.map((row) => ({ id: row.id, original: {
      transaction_date: row.transaction_date, amount: row.amount, title: row.title, category: row.category,
      payer: row.payer, memo: row.memo,
    } })) }),
  })
  if (typeof data !== 'object' || data === null || !('items' in data) || !Array.isArray(data.items) || data.items.length !== targets.length) throw new Error('一括変更の結果が正しくありません。')
  const expected = new Set(targets.map((row) => row.id))
  return data.items.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('id' in row) || !('status' in row)
      || !Number.isSafeInteger(row.id) || !expected.delete(Number(row.id))
      || !['updated', 'conflict', 'failed'].includes(String(row.status))) throw new Error('一括変更の結果が正しくありません。')
    if (row.status === 'updated') {
      const item = parseExpense('item' in row ? row.item : null)
      if (item.id !== row.id || item.category !== category || item.voided_at) throw new Error('一括変更の結果が正しくありません。')
      return { id: item.id, status: 'updated', item }
    }
    return { id: Number(row.id), status: row.status as 'conflict' | 'failed' }
  })
}

export async function createRecurringExpense(input: RecurringExpenseDraft): Promise<RecurringExpense> {
  const data = await requestJson('/api/recurring-expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'recurring-create' },
    body: JSON.stringify(input),
  })
  return parseRecurringExpense(data)
}

export async function setRecurringExpenseActive(id: number, active: boolean): Promise<RecurringExpense> {
  const data = await requestJson('/api/recurring-expenses', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'recurring-update' },
    body: JSON.stringify({ id, active }),
  })
  return parseRecurringExpense(data)
}

export async function updateRecurringExpense(input: RecurringExpenseUpdate): Promise<RecurringExpense> {
  const data = await requestJson('/api/recurring-expenses', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'recurring-edit' },
    body: JSON.stringify(input),
  })
  return parseRecurringExpense(data)
}

export async function runRecurringExpenses(): Promise<number> {
  const data = await requestJson('/api/recurring-expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Action': 'recurring-run' },
    body: '{}',
  })
  if (typeof data !== 'object' || data === null || !('generated' in data) || !Number.isSafeInteger(data.generated)) {
    throw new Error('定期登録の実行結果が正しくありません。')
  }
  return data.generated as number
}

export async function createExpense(input: ExpenseDraft): Promise<Expense> {
  const data = await requestJson('/api/expenses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dashboard-Action': 'expense-create',
    },
    body: JSON.stringify(input),
  })
  return parseExpense(data)
}

export async function setExpenseVoided(id: number, voided: boolean): Promise<Expense> {
  const data = await requestJson('/api/expenses', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Dashboard-Action': 'expense-void',
    },
    body: JSON.stringify({ id, voided }),
  })
  return parseExpense(data)
}

export async function updateExpense(id: number, input: ExpenseDraft, original: ExpenseSnapshot): Promise<Expense> {
  const data = await requestJson('/api/expenses', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Dashboard-Action': 'expense-update',
    },
    body: JSON.stringify({ id, ...input, original }),
  })
  return parseExpense(data)
}
