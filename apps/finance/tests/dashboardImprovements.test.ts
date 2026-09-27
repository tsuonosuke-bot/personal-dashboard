import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { financeCsv, onRequest as exportRoute } from '../functions/api/export.ts'
import { onRequest as statusRoute } from '../functions/api/status.ts'

const env = {
  SUPABASE_URL: 'https://finance-db.example',
  SUPABASE_SECRET_KEY: 'server-secret-key',
  AUTH_MODE: 'basic',
}

test('Finance CSVはBOM・CRLF・引用符を含む表計算向け形式にする', () => {
  const csv = financeCsv([{ transaction_date: '2026-09-22', amount: 1200, title: '昼食, "特別"', memo: '1行目\n2行目' }])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /^\uFEFF日付,金額,内容,カテゴリ,支払者,メモ,Notion URL,登録日時\r\n/)
  assert.match(csv, /"昼食, ""特別"""/)
  assert.match(csv, /"1行目\n2行目"/)
  assert.match(csv, /\r\n$/)
})

test('FinanceはCSV添付と全体スナップショット向けJSONを読み取り専用で返す', async () => {
  const originalFetch = globalThis.fetch
  const seenTables: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(new Headers(init?.headers).get('apikey'), 'server-secret-key')
    const table = url.pathname.split('/').at(-1) || ''
    seenTables.push(table)
    if (table === 'expenses') return Response.json([{ id: 1, transaction_date: '2026-09-22', amount: 500, title: '昼食' }])
    if (table === 'budget_categories') return Response.json([{ id: 1, name: '食費' }])
    if (table === 'recurring_expenses') return Response.json([{ id: 1, title: '家賃' }])
    throw new Error(`unexpected table ${table}`)
  }
  try {
    const csvResponse = await exportRoute({ request: new Request('https://dashboard.example/api/export'), env })
    assert.equal(csvResponse.status, 200)
    assert.equal(csvResponse.headers.get('Content-Type'), 'text/csv; charset=utf-8')
    assert.match(csvResponse.headers.get('Content-Disposition') || '', /^attachment; filename="finance-export-/)
    assert.match(await csvResponse.text(), /昼食/)

    const jsonResponse = await exportRoute({ request: new Request('https://dashboard.example/api/export?format=json'), env })
    assert.equal(jsonResponse.status, 200)
    const payload = await jsonResponse.json() as Record<string, any>
    assert.equal(payload.schemaVersion, 'finance-export.v1')
    assert.equal(payload.readOnly, true)
    assert.equal(payload.expenses[0].title, '昼食')
    assert.equal(payload.categories[0].name, '食費')
    assert.equal(payload.recurringExpenses[0].title, '家賃')
    assert.deepEqual([...new Set(seenTables)].sort(), ['budget_categories', 'expenses', 'recurring_expenses'])
    assert.doesNotMatch(JSON.stringify(payload), /server-secret-key/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Finance接続状態は要求された4項目だけを返す', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json([{ migration: '202609220001_connection_status' }])
  try {
    const response = await statusRoute({ request: new Request('https://dashboard.example/api/status'), env })
    assert.equal(response.status, 200)
    const payload = await response.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(payload).sort(), ['authMethod', 'destination', 'lastSuccessAt', 'migration'].sort())
    assert.equal(payload.destination, 'finance-db.example')
    assert.equal(payload.migration, '202609220001_connection_status')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Finance画面は直接記録・CSV・共通状態・グラフ要約・再読込を提供する', async () => {
  const [app, category, trend, recurring, style, migration] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CategoryPieChart.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MonthlyTrendChart.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/RecurringExpenseModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/202609220001_connection_status.sql', import.meta.url), 'utf8'),
  ])
  assert.match(app, /URLSearchParams\(window\.location\.search\)\.get\('new'\) === 'expense'/)
  assert.match(app, /href="api\/export"/)
  assert.match(app, /personal-dashboard-7md\.pages\.dev\/status\//)
  assert.match(category, /category-chart-summary/)
  assert.match(category, /role="img"/)
  assert.match(trend, /monthly-trend-summary/)
  assert.match(trend, /aria-describedby/)
  assert.match(recurring, /onReload/)
  assert.match(recurring, />再試行</)
  assert.match(style, /\.chart-summary/)
  assert.match(migration, /notify pgrst, 'reload schema'/i)
})
