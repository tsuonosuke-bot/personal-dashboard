import { jsonResponse, methodNotAllowed, readPagination, type SupabaseEnv } from '../_shared/supabaseRest.ts'
import { financeRpc, readFinanceScope, validPlainDate } from '../_shared/financeReads.ts'
import { parseExpense, parsePageEnvelope } from '../../../../finance/src/lib/apiValidation.ts'

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const scope = readFinanceScope(request), page = readPagination(request)
  if (scope instanceof Response) return scope
  if (page instanceof Response) return page
  const search = new URL(request.url).searchParams
  const from = search.get('from'), to = search.get('to'), query = search.get('q') ?? ''
  const type = search.get('type') ?? 'all', sort = search.get('sort') ?? 'newest'
  const voided = search.get('voided') ?? '0'
  const min = search.get('amount_min'), max = search.get('amount_max')
  const amount = (value: string | null) => value === null || value === '' ? null : Number(value)
  const minimum = amount(min), maximum = amount(max)
  if ((from !== null && !validPlainDate(from)) || (to !== null && !validPlainDate(to)) || query.length > 500
    || !['all', 'expense', 'income'].includes(type) || !['newest', 'oldest', 'amount-desc', 'amount-asc'].includes(sort)
    || !['0', '1'].includes(voided) || [minimum, maximum].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return jsonResponse({ error: '明細の表示条件が正しくありません。' }, 400)
  }
  const result = await financeRpc(env, 'get_finance_expense_page', { ...scope, p_query: query, p_from: from, p_to: to,
    p_type: type, p_sort: sort, p_voided: voided === '1', p_amount_min: minimum, p_amount_max: maximum,
    p_limit: page.limit, p_offset: page.offset, p_count: page.count !== 'none' }, request.signal)
  if (result instanceof Response) return result
  try {
    const envelope = parsePageEnvelope(result)
    if (envelope.limit !== page.limit || envelope.offset !== page.offset || envelope.items.length > page.limit) throw new Error('page mismatch')
    return jsonResponse({ ...envelope, items: envelope.items.map(parseExpense) })
  } catch { return jsonResponse({ error: 'DBから想定外の明細を受信しました。' }, 502) }
}
