import { jsonResponse, methodNotAllowed, type SupabaseEnv } from '../_shared/supabaseRest.ts'
import { financeRpc, readFinanceScope } from '../_shared/financeReads.ts'
import { parseFinanceOverview } from '../../../../finance/src/lib/financeOverview.ts'

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const scope = readFinanceScope(request)
  if (scope instanceof Response) return scope
  const result = await financeRpc(env, 'get_finance_overview', scope, request.signal)
  if (result instanceof Response) return result
  try { return jsonResponse(parseFinanceOverview(result)) }
  catch { return jsonResponse({ error: 'DBから想定外の集計結果を受信しました。' }, 502) }
}
