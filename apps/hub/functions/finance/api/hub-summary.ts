import { jsonResponse, methodNotAllowed, type SupabaseEnv } from '../_shared/supabaseRest.ts'
import { financeRpc, validPlainDate } from '../_shared/financeReads.ts'

function optionalCount(result: object, key: string): boolean {
  if (!(key in result)) return true
  const value = (result as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export async function onRequest({ request, env }: { request: Request; env: SupabaseEnv }): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const today = new URL(request.url).searchParams.get('today')
  if (!today || !validPlainDate(today)) return jsonResponse({ error: '日付の指定が正しくありません。' }, 400)
  const result = await financeRpc(env, 'get_finance_hub_summary', { p_today: today }, request.signal)
  if (result instanceof Response) return result
  if (typeof result !== 'object' || result === null || !('currentMonthSpend' in result) || !('previousMonthSpend' in result)
    || !('recentExpenses' in result) || typeof result.currentMonthSpend !== 'number' || !Number.isFinite(result.currentMonthSpend)
    || typeof result.previousMonthSpend !== 'number' || !Number.isFinite(result.previousMonthSpend)
    || !Array.isArray(result.recentExpenses) || result.recentExpenses.length > 5
    // 先月同日までの支出・未分類の件数（#340）は後から足した項目。古いDB関数では欠けるので、あるときだけ検証する。
    || !optionalCount(result, 'previousMonthToDateSpend') || !optionalCount(result, 'unclassifiedCount')) return jsonResponse({ error: 'DBから想定外の集計結果を受信しました。' }, 502)
  return jsonResponse(result)
}
