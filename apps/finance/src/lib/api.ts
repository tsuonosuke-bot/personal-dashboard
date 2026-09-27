import type { BudgetCategory, Expense, ExpenseDraft, ExpenseSnapshot, RecurringExpense, RecurringExpenseDraft, RecurringExpenseUpdate } from './types'
import { parseBudgetCategory, parseExpense, parsePageEnvelope, parseRecurringExpense } from './apiValidation'
import { readApiResponse, responseMessage } from './http'

type ErrorBody = { error?: unknown }

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
    throw new Error(message)
  }
  return responseBody
}

const API_PAGE_SIZE = 1_000
const MAX_PAGE_REQUESTS = 10_000

async function getAllPages<T>(path: string, parseItem: (value: unknown) => T): Promise<T[]> {
  const result: T[] = []
  let offset = 0
  for (let requestCount = 0; requestCount < MAX_PAGE_REQUESTS; requestCount += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const data = await requestJson(`${path}${separator}limit=${API_PAGE_SIZE}&offset=${offset}`)
    const page = parsePageEnvelope(data)
    if (page.offset !== offset || page.limit !== API_PAGE_SIZE) {
      throw new Error('APIのページ情報が要求内容と一致しません。')
    }
    result.push(...page.items.map(parseItem))
    if (page.items.length === 0) return result
    offset += page.items.length
    if (page.total !== null && offset >= page.total) return result
  }
  throw new Error('データ件数が安全な取得上限を超えています。')
}

export function getExpenses(): Promise<Expense[]> {
  return getAllPages('/api/expenses', parseExpense)
}

export function getBudgetCategories(): Promise<BudgetCategory[]> {
  return getAllPages('/api/budget-categories', parseBudgetCategory)
}

export function getRecurringExpenses(): Promise<RecurringExpense[]> {
  return getAllPages('/api/recurring-expenses', parseRecurringExpense)
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
