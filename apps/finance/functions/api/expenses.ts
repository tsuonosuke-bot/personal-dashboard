import {
  fetchSupabasePage,
  insertSupabaseRow,
  jsonResponse,
  methodNotAllowed,
  readPagination,
  supabaseEq,
  type SupabaseEnv,
  updateSupabaseRow,
} from '../_shared/supabaseRest.ts'
import {
  EXPENSE_CREATE_ACTION_HEADER,
  EXPENSE_UPDATE_ACTION_HEADER,
  EXPENSE_VOID_ACTION_HEADER,
  readExpenseInput,
  readExpenseUpdateInput,
  readExpenseVoidInput,
  validateExpenseMutationRequest,
} from '../_shared/expenseValidation.ts'

type FunctionContext = {
  request: Request
  env: SupabaseEnv
}

const SELECT_COLUMNS = 'id,transaction_date,amount,title,category,payer,memo,notion_url,notion_created_at,created_at,voided_at'

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === 'GET') {
    const pagination = readPagination(context.request)
    if (pagination instanceof Response) return pagination
    const params = new URLSearchParams({
      select: SELECT_COLUMNS,
      order: 'transaction_date.desc,id.desc',
    })
    // 取消済みは既定で返さない（Hubの集計もこの既定を使う）。Finance画面だけが復元用に include_voided=1 で取得する。
    const search = new URL(context.request.url).searchParams
    if (search.get('include_voided') !== '1') params.set('voided_at', 'is.null')
    // Hubの集計は今月と先月しか使わないので、取引日の下限で絞れるようにする。
    const from = search.get('from')
    if (from !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
        return jsonResponse({ error: 'fromはYYYY-MM-DD形式で指定してください。' }, 400)
      }
      params.set('transaction_date', `gte.${from}`)
    }
    return fetchSupabasePage(context.env, { table: 'expenses', params }, pagination)
  }
  if (context.request.method === 'PATCH' && context.request.headers.get('X-Dashboard-Action') === EXPENSE_VOID_ACTION_HEADER) {
    const guard = validateExpenseMutationRequest(context.request, EXPENSE_VOID_ACTION_HEADER)
    if (guard) return jsonResponse({ error: guard.error }, guard.status)
    const input = await readExpenseVoidInput(context.request)
    if (!input.ok) return jsonResponse({ error: input.error }, input.status)
    const { id, voided } = input.value
    return updateSupabaseRow(context.env, 'expenses', SELECT_COLUMNS, new URLSearchParams({
      id: `eq.${id}`,
      voided_at: voided ? 'is.null' : 'not.is.null',
    }), { voided_at: voided ? new Date().toISOString() : null })
  }
  if (context.request.method === 'PATCH') {
    const guard = validateExpenseMutationRequest(context.request, EXPENSE_UPDATE_ACTION_HEADER)
    if (guard) return jsonResponse({ error: guard.error }, guard.status)
    const input = await readExpenseUpdateInput(context.request)
    if (!input.ok) return jsonResponse({ error: input.error }, input.status)
    const { id, changes, original } = input.value
    return updateSupabaseRow(context.env, 'expenses', SELECT_COLUMNS, new URLSearchParams({
      id: `eq.${id}`,
      transaction_date: supabaseEq(original.transaction_date),
      amount: `eq.${original.amount}`,
      title: supabaseEq(original.title),
      category: supabaseEq(original.category),
      payer: original.payer === null ? 'is.null' : supabaseEq(original.payer),
      memo: original.memo === null ? 'is.null' : supabaseEq(original.memo),
      voided_at: 'is.null',
    }), changes)
  }
  if (context.request.method !== 'POST') return methodNotAllowed('GET, POST, PATCH')
  const guard = validateExpenseMutationRequest(context.request, EXPENSE_CREATE_ACTION_HEADER)
  if (guard) return jsonResponse({ error: guard.error }, guard.status)
  const input = await readExpenseInput(context.request)
  if (!input.ok) return jsonResponse({ error: input.error }, input.status)
  return insertSupabaseRow(context.env, 'expenses', SELECT_COLUMNS, input.value)
}
