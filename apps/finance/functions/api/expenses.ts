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
  readExpenseInput,
  readExpenseUpdateInput,
  validateExpenseMutationRequest,
} from '../_shared/expenseValidation.ts'

type FunctionContext = {
  request: Request
  env: SupabaseEnv
}

const SELECT_COLUMNS = 'id,transaction_date,amount,title,category,payer,memo,notion_url,notion_created_at,created_at'

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method === 'GET') {
    const pagination = readPagination(context.request)
    if (pagination instanceof Response) return pagination
    return fetchSupabasePage(context.env, {
      table: 'expenses',
      params: new URLSearchParams({
        select: SELECT_COLUMNS,
        order: 'transaction_date.desc,id.desc',
      }),
    }, pagination)
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
    }), changes)
  }
  if (context.request.method !== 'POST') return methodNotAllowed('GET, POST, PATCH')
  const guard = validateExpenseMutationRequest(context.request, EXPENSE_CREATE_ACTION_HEADER)
  if (guard) return jsonResponse({ error: guard.error }, guard.status)
  const input = await readExpenseInput(context.request)
  if (!input.ok) return jsonResponse({ error: input.error }, input.status)
  return insertSupabaseRow(context.env, 'expenses', SELECT_COLUMNS, input.value)
}
