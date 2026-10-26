import { financeRpc } from '../_shared/financeReads.ts'
import { validOriginalSnapshot, validateExpenseMutationRequest } from '../_shared/expenseValidation.ts'
import { jsonResponse, methodNotAllowed, type SupabaseEnv } from '../_shared/supabaseRest.ts'
import { parseExpense } from '../../src/lib/apiValidation.ts'

const MAX_CHARS = 96_000
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const onRequest = async ({ request, env }: { request: Request; env: SupabaseEnv }): Promise<Response> => {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const guard = validateExpenseMutationRequest(request, 'expense-categories', MAX_CHARS * 4)
  if (guard) return jsonResponse({ error: guard.error }, guard.status)
  let input: unknown
  try {
    const raw = await request.text()
    if (raw.length > MAX_CHARS) return jsonResponse({ error: 'リクエストが大きすぎます。' }, 413)
    input = JSON.parse(raw)
  } catch { return jsonResponse({ error: 'JSONの形式が正しくありません。' }, 400) }
  if (!object(input) || Object.keys(input).some((key) => !['category', 'items'].includes(key))
    || typeof input.category !== 'string' || !input.category.trim() || input.category !== input.category.trim()
    || input.category.length > 100 || input.category === '97_未分類' || input.category.startsWith('80_')
    || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 25) return jsonResponse({ error: '一括変更の内容が正しくありません。' }, 400)
  const ids = new Set<number>()
  for (const item of input.items) {
    if (!object(item) || Object.keys(item).length !== 2 || !Number.isSafeInteger(item.id) || Number(item.id) <= 0
      || !validOriginalSnapshot(item.original, true) || item.original.category !== '97_未分類' || ids.has(Number(item.id))) {
      return jsonResponse({ error: '変更前の明細情報が正しくありません。' }, 400)
    }
    ids.add(Number(item.id))
  }
  const result = await financeRpc(env, 'bulk_categorize_expenses', { p_category: input.category, p_items: input.items }, request.signal)
  if (result instanceof Response) return result
  try {
    if (!Array.isArray(result) || result.length !== ids.size) throw new Error('invalid result')
    const seen = new Set<number>()
    const items = result.map((row: unknown) => {
      if (!object(row) || !Number.isSafeInteger(row.id) || !ids.has(Number(row.id)) || seen.has(Number(row.id))
        || !['updated', 'conflict', 'failed'].includes(String(row.status))) throw new Error('invalid result')
      seen.add(Number(row.id))
      if (row.status === 'updated') {
        const item = parseExpense(row.item)
        if (item.id !== row.id || item.category !== input.category || item.voided_at) throw new Error('invalid result')
        return { id: row.id, status: row.status, item }
      }
      return { id: row.id, status: row.status }
    })
    return jsonResponse({ items })
  } catch { return jsonResponse({ error: '一括変更の応答が正しくありません。再読み込みして確認してください。' }, 502) }
}
