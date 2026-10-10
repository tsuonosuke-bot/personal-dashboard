import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { onRequest as expensesRoute } from '../functions/api/expenses.ts'
import { financeCsv, onRequest as exportRoute } from '../functions/api/export.ts'

const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'secret-test-key' }
const row = { id: 7, transaction_date: '2026-10-01', amount: 1200, title: '二重登録', category: '10_食費', payer: null, memo: null, notion_url: null, notion_created_at: null, created_at: '2026-10-01T00:00:00Z' }

function voidRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://dashboard.example/api/expenses', {
    method: 'PATCH',
    headers: { Origin: 'https://dashboard.example', 'Content-Type': 'application/json', 'X-Dashboard-Action': 'expense-void', ...headers },
    body: JSON.stringify(body),
  })
}

async function withFetch(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => handler(decodeURIComponent(String(input)), init)
  try { await run() } finally { globalThis.fetch = originalFetch }
}

test('明細の一覧は既定で取消済みを除き、Finance画面用の include_voided=1 だけが全件を返す', async () => {
  const urls: string[] = []
  await withFetch((url) => { urls.push(url); return Response.json([], { headers: { 'Content-Range': '*/0' } }) }, async () => {
    await expensesRoute({ request: new Request('https://dashboard.example/api/expenses'), env })
    await expensesRoute({ request: new Request('https://dashboard.example/api/expenses?include_voided=1'), env })
  })
  assert.match(urls[0], /voided_at=is\.null/)
  assert.match(urls[0], /select=[^&]*voided_at/)
  assert.doesNotMatch(urls[1], /voided_at=is\.null/)
  assert.match(urls[1], /select=[^&]*voided_at/)
})

test('明細の一覧は from で取引日の下限を絞れ、不正な日付は拒否する', async () => {
  const urls: string[] = []
  await withFetch((url) => { urls.push(url); return Response.json([], { headers: { 'Content-Range': '*/0' } }) }, async () => {
    const ok = await expensesRoute({ request: new Request('https://dashboard.example/api/expenses?from=2026-09-01'), env })
    assert.equal(ok.status, 200)
    for (const bad of ['2026-9-1', '2026-13-40', 'x', '']) {
      const response = await expensesRoute({ request: new Request(`https://dashboard.example/api/expenses?from=${bad}`), env })
      assert.equal(response.status, 400, bad)
    }
  })
  assert.equal(urls.length, 1)
  assert.match(urls[0], /transaction_date=gte\.2026-09-01/)
  assert.match(urls[0], /voided_at=is\.null/)
})

test('取消は行を消さず、有効な明細だけに取消日時を入れる。復元は取消済みだけを戻す', async () => {
  const calls: Array<{ url: string; method?: string; body: Record<string, unknown> }> = []
  await withFetch((url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url, method: init?.method, body })
    return Response.json([{ ...row, voided_at: body.voided_at }])
  }, async () => {
    const voided = await expensesRoute({ request: voidRequest({ id: 7, voided: true }), env })
    assert.equal(voided.status, 200)
    const restored = await expensesRoute({ request: voidRequest({ id: 7, voided: false }), env })
    assert.equal(restored.status, 200)
  })
  assert.equal(calls[0].method, 'PATCH')
  assert.match(calls[0].url, /id=eq\.7/)
  assert.match(calls[0].url, /voided_at=is\.null/)
  assert.match(String(calls[0].body.voided_at), /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(Object.keys(calls[0].body), ['voided_at'])
  assert.match(calls[1].url, /voided_at=not\.is\.null/)
  assert.equal(calls[1].body.voided_at, null)
})

test('取消は別オリジン・不正な指定を拒否し、取消済みの二重取消は409にする', async () => {
  assert.equal((await expensesRoute({ request: voidRequest({ id: 7, voided: true }, { Origin: 'https://evil.example' }), env })).status, 403)
  assert.equal((await expensesRoute({ request: voidRequest({ id: 7, voided: 'yes' }), env })).status, 400)
  assert.equal((await expensesRoute({ request: voidRequest({ id: 0, voided: true }), env })).status, 400)
  assert.equal((await expensesRoute({ request: voidRequest({ id: 7, voided: true, amount: 1 }), env })).status, 400)
  await withFetch(() => Response.json([]), async () => {
    assert.equal((await expensesRoute({ request: voidRequest({ id: 7, voided: true }), env })).status, 409)
  })
})

test('取消済みの明細は編集できない', async () => {
  let url = ''
  await withFetch((seen) => { url = seen; return Response.json([]) }, async () => {
    const original = { transaction_date: '2026-10-01', amount: 1200, title: '二重登録', category: '10_食費', payer: null, memo: null }
    const response = await expensesRoute({ request: new Request('https://dashboard.example/api/expenses', {
      method: 'PATCH',
      headers: { Origin: 'https://dashboard.example', 'Content-Type': 'application/json', 'X-Dashboard-Action': 'expense-update' },
      body: JSON.stringify({ id: 7, transaction_date: '2026-10-01', amount: 1300, title: '二重登録', category: '10_食費', payer: null, memo: null, type: 'expense', original }),
    }), env })
    assert.equal(response.status, 409)
  })
  assert.match(url, /voided_at=is\.null/)
})

test('通常CSVは取消済みを除き、監査用CSVとJSONは取消日時つきで全件を出す', async () => {
  const urls: string[] = []
  const voidedRow = { ...row, id: 8, voided_at: '2026-10-09T01:02:03Z' }
  await withFetch((url) => {
    urls.push(url)
    if (url.includes('/expenses')) return Response.json(url.includes('voided_at=is.null') ? [{ ...row, voided_at: null }] : [{ ...row, voided_at: null }, voidedRow])
    return Response.json([])
  }, async () => {
    const normal = await (await exportRoute({ request: new Request('https://dashboard.example/api/export'), env })).text()
    assert.doesNotMatch(normal, /取消/)
    assert.equal(normal.trim().split('\r\n').length, 2)
    const auditResponse = await exportRoute({ request: new Request('https://dashboard.example/api/export?scope=all'), env })
    assert.match(auditResponse.headers.get('Content-Disposition') ?? '', /finance-export-audit-/)
    const audit = await auditResponse.text()
    assert.match(audit, /ID,日付,金額,.*,取消,取消日時/)
    assert.match(audit, /8,2026-10-01,1200,二重登録,.*,取消,2026-10-09T01:02:03Z/)
    const json = await (await exportRoute({ request: new Request('https://dashboard.example/api/export?format=json'), env })).json() as { expenses: Array<{ voided_at: string | null }> }
    assert.deepEqual(json.expenses.map((item) => item.voided_at), [null, '2026-10-09T01:02:03Z'])
  })
  const expenseUrls = urls.filter((url) => url.includes('/rest/v1/expenses'))
  assert.match(expenseUrls[0], /voided_at=is\.null/)
  assert.doesNotMatch(expenseUrls[1], /voided_at=is\.null/)
  assert.doesNotMatch(expenseUrls[2], /voided_at=is\.null/)
  assert.doesNotMatch(financeCsv([{ ...row, voided_at: null }]), /取消/)
})

test('取消は列追加だけで行と定期生成の履歴を残し、画面から取消・復元できる', async () => {
  const [migration, app, table, modal, hook] = await Promise.all([
    readFile(new URL('../supabase/migrations/202610090002_expense_void.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ExpenseTable.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ExpenseFormModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/useExpenses.ts', import.meta.url), 'utf8'),
  ])
  assert.match(migration, /add column if not exists voided_at timestamptz/)
  assert.doesNotMatch(migration, /\bdelete\b|recurring_expense_occurrences\s+(?:set|where)/i)
  assert.match(modal, /この明細を取り消す/)
  assert.match(app, /window\.confirm/)
  assert.match(app, /同じ日の分は再生成されません/)
  assert.match(app, /api\/export\?scope=all/)
  assert.match(table, /取消済みの明細/)
  assert.match(table, /復元/)
  assert.match(hook, /filter\(\(expense\) => !expense\.voided_at\)/)
})
