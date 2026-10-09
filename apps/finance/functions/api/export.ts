import { fetchSupabase, jsonResponse, methodNotAllowed, type SupabaseEnv } from '../_shared/supabaseRest.ts'

type FunctionContext = { request: Request; env: SupabaseEnv }
const PAGE_SIZE = 1_000

async function allRows(env: SupabaseEnv, table: string, select: string, order: string, filters: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  const rawUrl = env.SUPABASE_URL?.trim()
  const key = env.SUPABASE_SECRET_KEY?.trim()
  if (!rawUrl || !key) throw new Error('DB connection is not configured')
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, rawUrl)
    endpoint.searchParams.set('select', select)
    endpoint.searchParams.set('order', order)
    for (const [key, value] of Object.entries(filters)) endpoint.searchParams.set(key, value)
    endpoint.searchParams.set('limit', String(PAGE_SIZE))
    endpoint.searchParams.set('offset', String(offset))
    const response = await fetchSupabase(endpoint, { headers: { Accept: 'application/json', apikey: key } })
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('json')) throw new Error(`${table} export failed`)
    const page: unknown = await response.json()
    if (!Array.isArray(page) || page.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))) throw new Error(`${table} export returned invalid data`)
    rows.push(...page as Record<string, unknown>[])
    if (page.length < PAGE_SIZE) return rows
  }
}

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// audit: 取消済みも含む全件。取消フラグと取消日時の列を足す。
export function financeCsv(rows: Record<string, unknown>[], audit = false): string {
  const columns: Array<[string, string]> = [
    ['日付', 'transaction_date'], ['金額', 'amount'], ['内容', 'title'], ['カテゴリ', 'category'],
    ['支払者', 'payer'], ['メモ', 'memo'], ['Notion URL', 'notion_url'], ['登録日時', 'created_at'],
  ]
  const cells = (row: Record<string, unknown>) => {
    const values = columns.map(([, key]) => csvValue(row[key]))
    return audit ? [csvValue(row.id), ...values, row.voided_at ? '取消' : '', csvValue(row.voided_at)] : values
  }
  const labels = audit ? ['ID', ...columns.map(([label]) => label), '取消', '取消日時'] : columns.map(([label]) => label)
  return `\uFEFF${[
    labels.map(csvValue).join(','),
    ...rows.map((row) => cells(row).join(',')),
  ].join('\r\n')}\r\n`
}

function filename(now: Date, extension: 'csv' | 'json', audit = false): string {
  return `finance-export${audit ? '-audit' : ''}-${now.toISOString().replace(/[:.]/g, '-')}.${extension}`
}

export const onRequest = async ({ request, env }: FunctionContext): Promise<Response> => {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const now = new Date()
  try {
    const url = new URL(request.url)
    const format = url.searchParams.get('format')
    // 通常CSVは取消済みを除く。JSON（バックアップ）と scope=all（監査用CSV）は取消済みも voided_at 付きで含める。
    const audit = format === 'json' || url.searchParams.get('scope') === 'all'
    const expenses = await allRows(env, 'expenses', 'id,transaction_date,amount,title,category,payer,memo,notion_url,notion_created_at,created_at,voided_at', 'transaction_date.desc,id.desc', audit ? {} : { voided_at: 'is.null' })
    if (format === 'json') {
      const [categories, recurringExpenses] = await Promise.all([
        allRows(env, 'budget_categories', 'id,name,notion_url', 'id.asc'),
        allRows(env, 'recurring_expenses', 'id,source_expense_id,template_rule_id,frequency,interval_count,day_of_month,start_date,end_date,next_run_date,active,amount,title,category,payer,memo,last_generated_at,created_at,updated_at', 'active.desc,next_run_date.asc,id.asc'),
      ])
      return new Response(JSON.stringify({ schemaVersion: 'finance-export.v1', exportedAt: now.toISOString(), readOnly: true, expenses, categories, recurringExpenses }, null, 2), {
        headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${filename(now, 'json')}"`, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
      })
    }
    return new Response(financeCsv(expenses, audit), {
      headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${filename(now, 'csv', audit)}"`, 'Content-Type': 'text/csv; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) {
    console.error('finance export failed', error instanceof Error ? error.message : 'unknown')
    return jsonResponse({ error: 'Finance CSVを作成できませんでした。接続状態を確認して再試行してください。' }, 502)
  }
}
