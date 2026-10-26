import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMonthlyTrendData, filterExpensesByCategories, filterExpensesByPayer, summarizeMonth } from '../src/lib/finance.ts'
import { demoFinanceOverview, parseFinanceOverview, summaryFromAggregates, trendFromAggregates, type FinanceScope } from '../src/lib/financeOverview.ts'
import { emptyTransactionFilters, matchingExpenses } from '../src/lib/expensePaging.ts'
import { readAllPages } from '../src/lib/allPages.ts'
import { runCategoryBatches } from '../src/lib/bulkCategories.ts'
import { onRequest as overviewRoute } from '../functions/api/finance-overview.ts'
import { onRequest as pageRoute } from '../functions/api/expense-page.ts'
import { onRequest as bulkRoute } from '../functions/api/expense-categories.ts'
import type { Expense } from '../src/lib/types'

const expense = (id: number, overrides: Partial<Expense> = {}): Expense => ({ id, transaction_date: '2026-10-20', amount: 100,
  title: `明細${id}`, category: '97_未分類', payer: null, memo: null, notion_url: null, notion_created_at: null,
  created_at: '2026-10-20T00:00:00Z', voided_at: null, ...overrides })
const scope: FinanceScope = { month: '2026-10', categories: [], categoryMode: 'include', payer: '' }
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'fixture-only-key' }

test('12か月集計は過去10,000件の全件計算と一致し、全期間の月/カテゴリ/支払者候補を残す', () => {
  const rows = Array.from({ length: 10_100 }, (_, i) => expense(i + 1, {
    transaction_date: i < 10_000 ? '2001-01-01' : `2026-${i % 2 ? '09' : '10'}-20`,
    category: ['10_食費', '20_旅費', '80_給与', '97_未分類'][i % 4],
    amount: [100, -30, -1000, 0][i % 4], payer: i % 3 ? 'A' : '以前の支払者', voided_at: i % 13 ? null : '2026-10-01T00:00:00Z',
  }))
  for (const selected of [scope, { ...scope, categories: ['20_旅費'], categoryMode: 'exclude' as const }, { ...scope, payer: 'A' }]) {
    const result = parseFinanceOverview(demoFinanceOverview(rows, [], selected))
    const all = filterExpensesByPayer(filterExpensesByCategories(rows.filter((row) => !row.voided_at), selected.categories, selected.categoryMode), selected.payer)
    assert.deepEqual(summaryFromAggregates(result.monthly, selected.month), summarizeMonth(all, selected.month))
    assert.deepEqual(trendFromAggregates(result.monthly, selected.month), buildMonthlyTrendData(all, selected.month))
    assert.ok(result.metadata.months.includes('2001-01'))
    assert.ok(result.metadata.payers.includes('以前の支払者'))
    assert.ok(result.monthly.every((row) => row.month >= '2025-11'))
    assert.ok(JSON.stringify(result).length < JSON.stringify(rows).length / 100)
  }
  const old = demoFinanceOverview(rows, [], { ...scope, month: '2001-01' })
  assert.equal(old.selectedMonth, '2001-01')
  assert.equal(matchingExpenses(rows, { ...scope, month: '2001-01' }, emptyTransactionFilters).length, 9230)
})

test('明細検索はキーワード/期間/絶対金額/種別/並び順を組み合わせ、50件ページの外も検索する', () => {
  const rows = Array.from({ length: 130 }, (_, i) => expense(i + 1, { amount: -i, memo: i === 2 ? '外_側%' : null }))
  assert.deepEqual(matchingExpenses(rows, scope, { ...emptyTransactionFilters, query: '外_側%', type: 'expense', amountMin: '2', amountMax: '2' }).map((row) => row.id), [3])
  assert.deepEqual(matchingExpenses(rows, scope, { ...emptyTransactionFilters, sort: 'oldest' }).slice(50, 100).map((row) => row.id), Array.from({ length: 50 }, (_, i) => i + 51))
  assert.equal(matchingExpenses(rows, { ...scope, month: '2026-09' }, emptyTransactionFilters).length, 0)
})

test('全件取得の0/999/1000/1001/2000件と件数不明を欠落なく読み、後続ページはcount:noneを明示する', async () => {
  for (const size of [0, 999, 1000, 1001, 2000]) for (const known of [true, false]) {
    const requests: URL[] = []
    const values = Array.from({ length: size }, (_, i) => i)
    const result = await readAllPages('/api/expenses?include_voided=1', Number, async (path) => {
      const url = new URL(path, 'https://fixture.example'); requests.push(url)
      const offset = Number(url.searchParams.get('offset'))
      return { items: values.slice(offset, offset + 1000), limit: 1000, offset, total: known && offset === 0 ? size : null }
    })
    assert.deepEqual(result, values)
    assert.equal(requests[0].searchParams.get('count'), 'exact')
    assert.ok(requests.slice(1).every((url) => url.searchParams.get('count') === 'none'))
  }
})

test('一括分類は25件ずつ送り、部分失敗と途中中止を残し、画面更新は成功したまとまりごとだけ行う', async () => {
  const rows = Array.from({ length: 75 }, (_, i) => expense(i + 1, { amount: i % 2 ? -100 : 100 }))
  let stopped = false, requests = 0
  const updates: Expense[][] = [], progress: number[] = []
  const result = await runCategoryBatches(rows, '10_食費', {
    shouldStop: () => stopped, onProgress: (n) => progress.push(n), onUpdated: (values) => updates.push(values),
  }, async (chunk) => {
    requests += 1
    assert.equal(chunk.length, 25)
    stopped = true
    return chunk.map((row) => row.id === 1 ? { id: row.id, status: 'conflict' } : row.id === 2 ? { id: row.id, status: 'failed' }
      : { id: row.id, status: 'updated', item: { ...row, category: '10_食費' } })
  })
  assert.equal(requests, 1); assert.equal(updates.length, 1); assert.equal(updates[0].length, 23)
  assert.deepEqual(progress, [25]); assert.deepEqual(result.conflicts, [1]); assert.deepEqual(result.failed, [2])
  assert.equal(result.skipped.length, 50)
  assert.equal(updates[0][0].amount, rows[2].amount)
  const failed = await runCategoryBatches(rows.slice(0, 30), '10_食費', {
    shouldStop: () => false, onProgress: () => {}, onUpdated: () => assert.fail('failed batch has no updates'),
  }, async () => { throw new Error('connection lost') })
  assert.equal(failed.failed.length, 30)
})

test('新しい集計/ページAPIは入力を検証し、private no-storeで必要な条件だけRPCへ渡す', async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; args: Record<string, unknown> }> = []
  globalThis.fetch = async (url, init) => {
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push({ url: String(url), args })
    return Response.json(String(url).includes('get_finance_overview') ? demoFinanceOverview([expense(1)], [], scope)
      : { items: [expense(1)], total: null, limit: 50, offset: 50 })
  }
  try {
    const result = await overviewRoute({ request: new Request('https://fixture.example/api/finance-overview?month=2026-10'), env })
    assert.equal(result.status, 200); assert.match(result.headers.get('Cache-Control') ?? '', /private.*no-store/)
    const page = await pageRoute({ request: new Request('https://fixture.example/api/expense-page?month=2026-10&limit=50&offset=50&count=none&q=%25_%26&voided=1'), env })
    assert.equal(page.status, 200)
    assert.equal(calls[1].args.p_count, false); assert.equal(calls[1].args.p_query, '%_&'); assert.equal(calls[1].args.p_voided, true)
    const count = calls.length
    for (const query of ['month=2026-13', 'month=2026-10&type=bad', 'month=2026-10&from=2026-02-30', 'month=2026-10&amount_min=-1']) {
      assert.equal((await pageRoute({ request: new Request(`https://fixture.example/api/expense-page?${query}`), env })).status, 400)
    }
    assert.equal(calls.length, count)
  } finally { globalThis.fetch = original }
})

test('一括分類APIは送信元/上限/重複/変更前情報を検証し、部分結果のIDを照合する', async () => {
  const row = expense(1, { amount: -123 })
  const { id, transaction_date, amount, title, category, payer, memo } = row
  const item = { id, original: { transaction_date, amount, title, category, payer, memo } }
  const request = (items: unknown[], origin = 'https://fixture.example') => new Request('https://fixture.example/api/expense-categories', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Dashboard-Action': 'expense-categories' },
    body: JSON.stringify({ category: '10_食費', items }),
  })
  assert.equal((await bulkRoute({ request: request([item], 'https://evil.example'), env })).status, 403)
  assert.equal((await bulkRoute({ request: request(Array(26).fill(item)), env })).status, 400)
  assert.equal((await bulkRoute({ request: request([item, item]), env })).status, 400)
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).p_items[0].original.amount, -123)
    return Response.json([{ id, status: 'updated', item: { ...row, category: '10_食費' } }])
  }
  try { assert.equal((await bulkRoute({ request: request([item]), env })).status, 200) }
  finally { globalThis.fetch = original }
})
