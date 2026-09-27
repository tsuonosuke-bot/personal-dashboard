import { fetchSupabasePage, jsonResponse, methodNotAllowed, readPagination, type SupabaseEnv } from '../_shared/supabaseRest.ts'
import { readRecurringCreate, readRecurringEdit, readRecurringUpdate, validateRecurringRequest } from '../_shared/recurringValidation.ts'

type FunctionContext = { request: Request; env: SupabaseEnv }
const SELECT = 'id,source_expense_id,template_rule_id,frequency,interval_count,day_of_month,start_date,end_date,next_run_date,active,amount,title,category,payer,memo,last_generated_at,created_at,updated_at'

async function supabaseRequest(env: SupabaseEnv, path: string, method: 'POST' | 'PATCH', body: unknown, query?: URLSearchParams): Promise<Response> {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)
  const endpoint = new URL(path, env.SUPABASE_URL)
  if (query) endpoint.search = query.toString()
  try {
    const response = await fetch(endpoint, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'return=representation', apikey: env.SUPABASE_SECRET_KEY }, body: JSON.stringify(body) })
    if (!response.ok) return jsonResponse({ error: '定期登録をDBへ保存できませんでした。' }, 502)
    const value: unknown = await response.json()
    return jsonResponse(value)
  } catch { return jsonResponse({ error: 'DBへの接続中にエラーが発生しました。' }, 502) }
}

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method === 'GET') {
    const pagination = readPagination(request)
    if (pagination instanceof Response) return pagination
    return fetchSupabasePage(env, { table: 'recurring_expenses', params: new URLSearchParams({ select: SELECT, order: 'active.desc,next_run_date.asc,id.asc' }) }, pagination)
  }
  if (request.method === 'POST') {
    const action = request.headers.get('X-Dashboard-Action')
    if (action === 'recurring-run') {
      const guard = validateRecurringRequest(request, 'recurring-run'); if (guard) return guard
      const response = await supabaseRequest(env, '/rest/v1/rpc/materialize_recurring_expenses', 'POST', {})
      if (!response.ok) return response
      const value: unknown = await response.json()
      return jsonResponse({ generated: typeof value === 'number' ? value : 0 })
    }
    const guard = validateRecurringRequest(request, 'recurring-create'); if (guard) return guard
    const input = await readRecurringCreate(request); if (input instanceof Response) return input
    const response = await supabaseRequest(env, '/rest/v1/rpc/create_recurring_expense_rule', 'POST', input)
    if (!response.ok) return response
    const value: unknown = await response.json()
    return jsonResponse(Array.isArray(value) ? value[0] : value, 201)
  }
  if (request.method === 'PATCH') {
    const action = request.headers.get('X-Dashboard-Action')
    const expectedAction = action === 'recurring-edit' ? 'recurring-edit' : 'recurring-update'
    const guard = validateRecurringRequest(request, expectedAction); if (guard) return guard
    const input = action === 'recurring-edit' ? await readRecurringEdit(request) : await readRecurringUpdate(request)
    if (input instanceof Response) return input
    const functionName = action === 'recurring-edit' ? 'update_recurring_expense_rule' : 'set_recurring_expense_active'
    const rpcBody = action === 'recurring-edit' ? input : { p_id: input.id, p_active: input.active }
    const response = await supabaseRequest(env, `/rest/v1/rpc/${functionName}`, 'POST', rpcBody)
    if (!response.ok) return response
    const value: unknown = await response.json()
    const row = Array.isArray(value) ? value[0] : value
    if (!row) return jsonResponse({ error: '更新対象を確認できませんでした。' }, 409)
    return jsonResponse(row)
  }
  return methodNotAllowed('GET, POST, PATCH')
}
