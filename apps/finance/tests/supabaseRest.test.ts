import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSupabasePage, insertSupabaseRow } from '../functions/_shared/supabaseRest.ts'

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'secret-test-key',
}

/** Supabaseへの呼び出しを数え、用意した応答を順番に返す。 */
async function withSupabase(responses: (() => Response)[], run: (calls: () => number) => Promise<void>) {
  let count = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    const next = responses[count++]
    if (!next) throw new Error('unexpected Supabase call')
    return next()
  }
  try {
    await run(() => count)
  } finally {
    globalThis.fetch = originalFetch
  }
}

const jwtRejected = () => Response.json(
  { code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' },
  { status: 401, headers: { 'Proxy-Status': 'PostgREST; error=PGRST303' } },
)
const page = { limit: 25, offset: 0 }
const query = { table: 'expenses' as const, params: new URLSearchParams({ select: 'id' }) }

test('同時リクエストでキーが一時的に拒否されたら（PGRST303）、1回だけやり直す', async () => {
  await withSupabase([jwtRejected, () => Response.json([{ id: 1 }], { headers: { 'Content-Range': '0-0/1' } })], async (calls) => {
    const response = await fetchSupabasePage(env, query, page)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { items: [{ id: 1 }], total: 1, limit: 25, offset: 0 })
    assert.equal(calls(), 2)
  })
  // ヘッダーが無くても本文のコードで判定する
  await withSupabase([
    () => Response.json({ code: 'PGRST303', message: 'JWT issued at future' }, { status: 401 }),
    () => Response.json([{ id: 7 }], { status: 201 }),
  ], async (calls) => {
    const response = await insertSupabaseRow(env, 'expenses', 'id', { amount: 100 })
    assert.equal(response.status, 201)
    assert.equal(calls(), 2)
  })
})

test('やり直しは1回だけで、ほかの認証エラーはやり直さない', async () => {
  await withSupabase([jwtRejected, jwtRejected], async (calls) => {
    const response = await fetchSupabasePage(env, query, page)
    assert.equal(response.status, 502)
    assert.equal(calls(), 2)
  })
  await withSupabase([
    () => Response.json({ code: '42501', message: 'permission denied for table expenses' }, { status: 401 }),
  ], async (calls) => {
    const response = await fetchSupabasePage(env, query, page)
    assert.equal(response.status, 502)
    assert.equal(calls(), 1)
  })
})
