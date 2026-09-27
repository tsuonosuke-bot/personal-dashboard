import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest as budgetRoute } from '../functions/api/budget-categories.ts'
import { onRequest as expensesRoute } from '../functions/api/expenses.ts'

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'secret-test-key',
}

test('expenses APIは取得列・安定順・ページ範囲を固定する', async () => {
  const originalFetch = globalThis.fetch
  let seenUrl = ''
  let seenHeaders: Record<string, string> | undefined
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input)
    seenHeaders = init?.headers as Record<string, string>
    return Response.json([{ id: 1 }], { headers: { 'Content-Range': '50-50/2624' } })
  }
  try {
    const response = await expensesRoute({
      request: new Request('https://dashboard.example/api/expenses?limit=25&offset=50'),
      env,
    })
    assert.equal(response.status, 200)
    const decodedUrl = decodeURIComponent(seenUrl)
    assert.match(decodedUrl, /select=id,transaction_date,amount,title,category,payer,memo,notion_url,notion_created_at,created_at/)
    assert.match(decodedUrl, /order=transaction_date.desc,id.desc/)
    assert.match(decodedUrl, /limit=25/)
    assert.match(decodedUrl, /offset=50/)
    assert.equal(seenHeaders?.apikey, 'secret-test-key')
    assert.deepEqual(await response.json(), { items: [{ id: 1 }], total: 2624, limit: 25, offset: 50 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('budget APIは読み取り専用で、不正なページ指定を拒否する', async () => {
  const methodResponse = await budgetRoute({
    request: new Request('https://dashboard.example/api/budget-categories', { method: 'POST' }),
    env,
  })
  assert.equal(methodResponse.status, 405)
  assert.equal(methodResponse.headers.get('Allow'), 'GET')

  const pageResponse = await budgetRoute({
    request: new Request('https://dashboard.example/api/budget-categories?limit=1001'),
    env,
  })
  assert.equal(pageResponse.status, 400)
})

test('DB接続設定がなければ503を返す', async () => {
  const response = await expensesRoute({
    request: new Request('https://dashboard.example/api/expenses'),
    env: {},
  })
  assert.equal(response.status, 503)
})
