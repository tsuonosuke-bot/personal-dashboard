import { jsonResponse, methodNotAllowed, type SupabaseEnv } from '../_shared/supabaseRest.ts'

interface StatusEnv extends SupabaseEnv { AUTH_MODE?: string }
type FunctionContext = { request: Request; env: StatusEnv }

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const rawUrl = env.SUPABASE_URL?.trim()
  const key = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !key) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)
  try {
    const base = new URL(rawUrl)
    const endpoint = new URL('/rest/v1/dashboard_schema_versions', base)
    endpoint.searchParams.set('select', 'migration')
    endpoint.searchParams.set('app_id', 'eq.financial-dashboard')
    endpoint.searchParams.set('limit', '1')
    const response = await fetch(endpoint, { headers: { Accept: 'application/json', apikey: key } })
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('json')) return jsonResponse({ error: 'DBの接続状態を確認できませんでした。' }, 502)
    const rows: unknown = await response.json()
    if (!Array.isArray(rows) || typeof rows[0]?.migration !== 'string') return jsonResponse({ error: 'DB migrationを確認できませんでした。' }, 502)
    return jsonResponse({
      authMethod: env.AUTH_MODE?.trim().toLowerCase() === 'access' ? 'Cloudflare Access' : 'Basic認証 + 署名付きセッション',
      destination: base.host,
      migration: rows[0].migration,
      lastSuccessAt: new Date().toISOString(),
    })
  } catch {
    return jsonResponse({ error: 'DBの接続状態を確認できませんでした。' }, 502)
  }
}
