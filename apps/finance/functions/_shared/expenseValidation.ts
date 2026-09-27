export const EXPENSE_CREATE_ACTION_HEADER = 'expense-create'
export const EXPENSE_UPDATE_ACTION_HEADER = 'expense-update'
const MAX_REQUEST_CHARS = 8_000

export type ExpenseCreateValue = {
  transaction_date: string
  amount: number
  title: string
  category: string
  payer: string | null
  memo: string | null
}

export type ExpenseSnapshot = ExpenseCreateValue

export type ExpenseUpdateValue = {
  id: number
  changes: ExpenseCreateValue
  original: ExpenseSnapshot
}

type ValidationResult =
  | { ok: true; value: ExpenseCreateValue }
  | { ok: false; status: number; error: string }

type UpdateValidationResult =
  | { ok: true; value: ExpenseUpdateValue }
  | { ok: false; status: number; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function requiredText(value: unknown, label: string, maxLength: number): { value: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: `${label}は必須です。` }
  const normalized = value.trim()
  return normalized.length <= maxLength ? { value: normalized } : { error: `${label}は${maxLength}文字以内で入力してください。` }
}

function optionalText(value: unknown, label: string, maxLength: number): { value: string | null } | { error: string } {
  if (value === null || value === undefined || value === '') return { value: null }
  if (typeof value !== 'string') return { error: `${label}の形式が正しくありません。` }
  const normalized = value.trim()
  return normalized.length <= maxLength ? { value: normalized || null } : { error: `${label}は${maxLength}文字以内で入力してください。` }
}

export function validateExpenseMutationRequest(
  request: Request,
  expectedAction = EXPENSE_CREATE_ACTION_HEADER,
): { status: number; error: string } | null {
  let expectedOrigin: string
  try {
    expectedOrigin = new URL(request.url).origin
  } catch {
    return { status: 400, error: 'リクエストURLが正しくありません。' }
  }
  if (request.headers.get('Origin') !== expectedOrigin) return { status: 403, error: '許可されていない送信元です。' }
  if (request.headers.get('X-Dashboard-Action') !== expectedAction) return { status: 403, error: '更新用ヘッダーがありません。' }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return { status: 415, error: 'JSON形式で送信してください。' }
  const declaredLength = Number(request.headers.get('Content-Length') || '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) return { status: 413, error: 'リクエストが大きすぎます。' }
  return null
}

function validateExpenseFields(input: Record<string, unknown>): ValidationResult {
  if (typeof input.transaction_date !== 'string' || !validDate(input.transaction_date)) {
    return { ok: false, status: 400, error: '日付をYYYY-MM-DD形式で入力してください。' }
  }
  if (input.type !== 'expense' && input.type !== 'income' && input.type !== 'offset') {
    return { ok: false, status: 400, error: '種別は支出、収入、支出の相殺から選択してください。' }
  }
  if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000) {
    return { ok: false, status: 400, error: '金額は1〜1,000,000,000円の整数で入力してください。' }
  }
  const title = requiredText(input.title, '内容', 200)
  if ('error' in title) return { ok: false, status: 400, error: title.error }
  const category = requiredText(input.category, 'カテゴリ', 100)
  if ('error' in category) return { ok: false, status: 400, error: category.error }
  const payer = optionalText(input.payer, '支払者', 100)
  if ('error' in payer) return { ok: false, status: 400, error: payer.error }
  const memo = optionalText(input.memo, 'メモ', 2_000)
  if ('error' in memo) return { ok: false, status: 400, error: memo.error }

  return {
    ok: true,
    value: {
      transaction_date: input.transaction_date,
      amount: input.type === 'income' || input.type === 'offset' ? -input.amount : input.amount,
      title: title.value,
      category: category.value,
      payer: payer.value,
      memo: memo.value,
    },
  }
}

function validOriginalSnapshot(value: unknown): value is ExpenseSnapshot {
  if (!isPlainObject(value)) return false
  const keys = ['transaction_date', 'amount', 'title', 'category', 'payer', 'memo']
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) return false
  if (typeof value.transaction_date !== 'string' || !validDate(value.transaction_date)) return false
  if (typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount === 0 || Math.abs(value.amount) > 1_000_000_000) return false
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) return false
  if (typeof value.category !== 'string' || !value.category.trim() || value.category.length > 100) return false
  if (value.payer !== null && (typeof value.payer !== 'string' || value.payer.length > 100)) return false
  return value.memo === null || (typeof value.memo === 'string' && value.memo.length <= 2_000)
}

export async function readExpenseInput(request: Request): Promise<ValidationResult> {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, status: 400, error: '入力内容を読み取れませんでした。' }
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: 'リクエストが大きすぎます。' }
  let input: unknown
  try {
    input = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, status: 400, error: 'JSONの形式が正しくありません。' }
  }
  if (!isPlainObject(input)) return { ok: false, status: 400, error: '入力内容の形式が正しくありません。' }
  const allowed = new Set(['transaction_date', 'amount', 'title', 'category', 'payer', 'memo', 'type'])
  const unknownKey = Object.keys(input).find((key) => !allowed.has(key))
  if (unknownKey) return { ok: false, status: 400, error: `登録できない項目が含まれています: ${unknownKey}` }

  return validateExpenseFields(input)
}

export async function readExpenseUpdateInput(request: Request): Promise<UpdateValidationResult> {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, status: 400, error: '入力内容を読み取れませんでした。' }
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: 'リクエストが大きすぎます。' }
  let input: unknown
  try {
    input = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, status: 400, error: 'JSONの形式が正しくありません。' }
  }
  if (!isPlainObject(input)) return { ok: false, status: 400, error: '入力内容の形式が正しくありません。' }
  const allowed = new Set(['id', 'transaction_date', 'amount', 'title', 'category', 'payer', 'memo', 'type', 'original'])
  const unknownKey = Object.keys(input).find((key) => !allowed.has(key))
  if (unknownKey) return { ok: false, status: 400, error: `更新できない項目が含まれています: ${unknownKey}` }
  if (!Number.isSafeInteger(input.id) || Number(input.id) <= 0) {
    return { ok: false, status: 400, error: '明細IDが正しくありません。' }
  }
  if (!validOriginalSnapshot(input.original)) {
    return { ok: false, status: 400, error: '編集前の家計簿情報が正しくありません。' }
  }
  const changes = validateExpenseFields(input)
  if (!changes.ok) return changes
  return { ok: true, value: { id: Number(input.id), changes: changes.value, original: input.original } }
}
