import { fetchSupabase, jsonResponse, type SupabaseEnv } from './supabaseRest.ts'

export function validPlainDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function readFinanceScope(request: Request): Record<string, unknown> | Response {
  const search = new URL(request.url).searchParams
  const month = search.get('month')
  const mode = search.get('category_mode') ?? 'include'
  const categories = search.getAll('category')
  const payer = search.get('payer')
  if (!month || !validPlainDate(`${month}-01`) || !/^\d{4}-\d{2}$/.test(month)
    || (mode !== 'include' && mode !== 'exclude') || categories.length > 500
    || categories.some((category) => !category.trim() || category.length > 100)
    || (payer !== null && payer.length > 100)) return jsonResponse({ error: '家計簿の表示条件が正しくありません。' }, 400)
  return { p_month: `${month}-01`, p_categories: categories.length ? categories : null, p_category_mode: mode, p_payer: payer || null }
}

export async function financeRpc(env: SupabaseEnv, name: 'get_finance_overview' | 'get_finance_expense_page' | 'get_finance_hub_summary' | 'bulk_categorize_expenses', args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown | Response> {
  const rawUrl = env.SUPABASE_URL?.trim(), key = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !key) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)
  try {
    const endpoint = new URL(`/rest/v1/rpc/${name}`, rawUrl)
    if (endpoint.protocol !== 'https:') return jsonResponse({ error: 'サーバーのDB接続先はHTTPSである必要があります。' }, 503)
    const response = await fetchSupabase(endpoint, { method: 'POST', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify(args) })
    if (!response.ok) {
      console.error(`Finance ${name} request failed with status ${response.status}`)
      return jsonResponse({ error: '家計簿のデータを処理できませんでした。時間をおいて再試行してください。' }, 502)
    }
    return await response.json()
  } catch {
    return jsonResponse({ error: 'DBへの接続中にエラーが発生しました。' }, 502)
  }
}
