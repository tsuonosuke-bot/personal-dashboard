export interface SupabaseEnv {
  SUPABASE_URL?: string
  SUPABASE_SECRET_KEY?: string
}

export type SupabaseTable = 'expenses' | 'budget_categories' | 'recurring_expenses'

type QueryDefinition = {
  table: SupabaseTable
  params: URLSearchParams
}

export type Pagination = { limit: number; offset: number }

const DEFAULT_PAGE_SIZE = 500
const MAX_PAGE_SIZE = 1_000

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export function methodNotAllowed(allow = 'GET'): Response {
  return new Response('Method Not Allowed\n', {
    status: 405,
    headers: {
      Allow: allow,
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

export async function insertSupabaseRow(
  env: SupabaseEnv,
  table: SupabaseTable,
  select: string,
  body: unknown,
): Promise<Response> {
  const rawUrl = env.SUPABASE_URL?.trim()
  const secretKey = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !secretKey) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)

  let endpoint: URL
  try {
    endpoint = new URL(`/rest/v1/${table}`, rawUrl)
  } catch {
    return jsonResponse({ error: 'サーバーのDB接続先が正しくありません。' }, 503)
  }
  if (endpoint.protocol !== 'https:') return jsonResponse({ error: 'サーバーのDB接続先はHTTPSである必要があります。' }, 503)
  endpoint.searchParams.set('select', select)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        apikey: secretKey,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      console.error(`Supabase ${table} insert failed with status ${response.status}`)
      return jsonResponse({ error: 'DBへの登録に失敗しました。' }, 502)
    }
    const rows: unknown = await response.json()
    if (!Array.isArray(rows) || rows.length !== 1) {
      console.error(`Supabase ${table} insert returned an unexpected response`)
      return jsonResponse({ error: '登録結果を確認できませんでした。' }, 502)
    }
    return jsonResponse(rows[0], 201)
  } catch (error) {
    console.error(`Supabase ${table} insert failed`, error instanceof Error ? error.message : 'unknown error')
    return jsonResponse({ error: 'DBへの接続中にエラーが発生しました。' }, 502)
  }
}

export function supabaseEq(value: string): string {
  // PostgRESTの単純な演算子は値を引用符で囲まない。囲むと引用符ごと比較され一致しなくなる。
  return `eq.${value}`
}

export async function updateSupabaseRow(
  env: SupabaseEnv,
  table: SupabaseTable,
  select: string,
  filters: URLSearchParams,
  body: unknown,
): Promise<Response> {
  const rawUrl = env.SUPABASE_URL?.trim()
  const secretKey = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !secretKey) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)

  let endpoint: URL
  try {
    endpoint = new URL(`/rest/v1/${table}`, rawUrl)
  } catch {
    return jsonResponse({ error: 'サーバーのDB接続先が正しくありません。' }, 503)
  }
  if (endpoint.protocol !== 'https:') return jsonResponse({ error: 'サーバーのDB接続先はHTTPSである必要があります。' }, 503)
  endpoint.search = filters.toString()
  endpoint.searchParams.set('select', select)

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        apikey: secretKey,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      console.error(`Supabase ${table} update failed with status ${response.status}`)
      return jsonResponse({ error: 'DBの更新に失敗しました。' }, 502)
    }
    const rows: unknown = await response.json()
    if (!Array.isArray(rows)) {
      console.error(`Supabase ${table} update returned an unexpected response`)
      return jsonResponse({ error: '更新結果を確認できませんでした。' }, 502)
    }
    if (rows.length === 0) return jsonResponse({ error: '別の画面で更新されています。最新データを再読み込みしてください。' }, 409)
    if (rows.length !== 1) return jsonResponse({ error: '更新対象を一意に確認できませんでした。' }, 409)
    return jsonResponse(rows[0])
  } catch (error) {
    console.error(`Supabase ${table} update failed`, error instanceof Error ? error.message : 'unknown error')
    return jsonResponse({ error: 'DBへの接続中にエラーが発生しました。' }, 502)
  }
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function readPagination(request: Request): Pagination | Response {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return jsonResponse({ error: 'リクエストURLが正しくありません。' }, 400)
  }
  const rawLimit = url.searchParams.get('limit')
  const rawOffset = url.searchParams.get('offset')
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : parseNonNegativeInteger(rawLimit)
  const offset = rawOffset === null ? 0 : parseNonNegativeInteger(rawOffset)
  if (limit === null || limit < 1 || limit > MAX_PAGE_SIZE) {
    return jsonResponse({ error: `limitは1〜${MAX_PAGE_SIZE}の整数で指定してください。` }, 400)
  }
  if (offset === null) return jsonResponse({ error: 'offsetは0以上の整数で指定してください。' }, 400)
  return { limit, offset }
}

function parseContentRange(value: string | null): number | null {
  const match = value?.match(/\/(\d+)$/)
  if (!match) return null
  const total = Number(match[1])
  return Number.isSafeInteger(total) ? total : null
}

export async function fetchSupabasePage(
  env: SupabaseEnv,
  query: QueryDefinition,
  pagination: Pagination,
): Promise<Response> {
  const rawUrl = env.SUPABASE_URL?.trim()
  const secretKey = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !secretKey) return jsonResponse({ error: 'サーバーのDB接続設定が未完了です。' }, 503)

  let endpoint: URL
  try {
    endpoint = new URL(`/rest/v1/${query.table}`, rawUrl)
  } catch {
    return jsonResponse({ error: 'サーバーのDB接続先が正しくありません。' }, 503)
  }
  if (endpoint.protocol !== 'https:') return jsonResponse({ error: 'サーバーのDB接続先はHTTPSである必要があります。' }, 503)

  endpoint.search = query.params.toString()
  endpoint.searchParams.set('limit', String(pagination.limit))
  endpoint.searchParams.set('offset', String(pagination.offset))

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: secretKey,
        Prefer: 'count=exact',
      },
    })
    if (!response.ok) {
      console.error(`Supabase ${query.table} request failed with status ${response.status}`)
      return jsonResponse({ error: 'DBからデータを取得できませんでした。' }, 502)
    }
    const rows: unknown = await response.json()
    if (!Array.isArray(rows)) {
      console.error(`Supabase ${query.table} returned a non-array response`)
      return jsonResponse({ error: 'DBから想定外の応答を受信しました。' }, 502)
    }
    return jsonResponse({
      items: rows,
      total: parseContentRange(response.headers.get('Content-Range')),
      limit: pagination.limit,
      offset: pagination.offset,
    })
  } catch (error) {
    console.error(`Supabase ${query.table} request failed`, error instanceof Error ? error.message : 'unknown error')
    return jsonResponse({ error: 'DBへの接続中にエラーが発生しました。' }, 502)
  }
}
