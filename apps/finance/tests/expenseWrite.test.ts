import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest as expensesRoute } from '../functions/api/expenses.ts'

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'secret-test-key',
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://dashboard.example/api/expenses', {
    method: 'POST',
    headers: {
      Origin: 'https://dashboard.example',
      'Content-Type': 'application/json',
      'X-Dashboard-Action': 'expense-create',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function updateRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://dashboard.example/api/expenses', {
    method: 'PATCH',
    headers: {
      Origin: 'https://dashboard.example',
      'Content-Type': 'application/json',
      'X-Dashboard-Action': 'expense-update',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const validInput = {
  transaction_date: '2026-09-15',
  amount: 1200,
  title: 'ランチ',
  category: '01_食費',
  payer: '本人',
  memo: null,
  type: 'expense',
}

test('家計簿を検証して1件登録する', async () => {
  const originalFetch = globalThis.fetch
  let seenInit: RequestInit | undefined
  globalThis.fetch = async (_input, init) => {
    seenInit = init
    return Response.json([{ id: 7, ...validInput, created_at: '2026-09-15T00:00:00Z' }])
  }
  try {
    const response = await expensesRoute({ request: createRequest(validInput), env })
    assert.equal(response.status, 201)
    const headers = seenInit?.headers as Record<string, string>
    assert.equal(headers.apikey, 'secret-test-key')
    assert.equal(headers.Prefer, 'return=representation')
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      transaction_date: '2026-09-15', amount: 1200, title: 'ランチ', category: '01_食費', payer: '本人', memo: null,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('収入は負数に正規化し、別オリジンと不正金額を拒否する', async () => {
  const originalFetch = globalThis.fetch
  let inserted: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    inserted = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json([{ id: 8 }])
  }
  try {
    const income = await expensesRoute({ request: createRequest({ ...validInput, type: 'income' }), env })
    assert.equal(income.status, 201)
    assert.equal(inserted?.amount, -1200)
    const crossOrigin = await expensesRoute({
      request: createRequest(validInput, { Origin: 'https://attacker.example' }), env,
    })
    assert.equal(crossOrigin.status, 403)
    const invalidAmount = await expensesRoute({ request: createRequest({ ...validInput, amount: 0 }), env })
    assert.equal(invalidAmount.status, 400)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('支出の相殺は非収入カテゴリの負数として保存する', async () => {
  const originalFetch = globalThis.fetch
  let inserted: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    inserted = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json([{ id: 9 }])
  }
  try {
    const response = await expensesRoute({ request: createRequest({ ...validInput, type: 'offset' }), env })
    assert.equal(response.status, 201)
    assert.equal(inserted?.amount, -1200)
    assert.equal(inserted?.category, '01_食費')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('編集前の値を条件にして家計簿を1件更新する', async () => {
  const originalFetch = globalThis.fetch
  let seenUrl = ''
  let seenInit: RequestInit | undefined
  const original = {
    transaction_date: '2026-09-15',
    amount: 1200,
    title: 'ランチ, A店',
    category: '01_食費',
    payer: '本人',
    memo: null,
  }
  globalThis.fetch = async (input, init) => {
    seenUrl = decodeURIComponent(String(input))
    seenInit = init
    return Response.json([{
      id: 7,
      ...original,
      amount: 1500,
      title: '夕食',
      notion_url: null,
      notion_created_at: null,
      created_at: '2026-09-15T00:00:00Z',
    }])
  }
  try {
    const response = await expensesRoute({
      request: updateRequest({ ...validInput, id: 7, amount: 1500, title: '夕食', original }),
      env,
    })
    assert.equal(response.status, 200)
    assert.equal(seenInit?.method, 'PATCH')
    assert.match(seenUrl, /id=eq\.7/)
    assert.equal(new URL(seenUrl).searchParams.get('title'), 'eq.ランチ, A店')
    assert.match(seenUrl, /memo=is\.null/)
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      transaction_date: '2026-09-15', amount: 1500, title: '夕食', category: '01_食費', payer: '本人', memo: null,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('編集対象が途中で変わった場合は409で上書きを止める', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json([])
  try {
    const original = {
      transaction_date: '2026-09-15', amount: 1200, title: 'ランチ', category: '01_食費', payer: '本人', memo: null,
    }
    const response = await expensesRoute({
      request: updateRequest({ ...validInput, id: 7, original }),
      env,
    })
    assert.equal(response.status, 409)
    assert.match(String((await response.json() as { error: string }).error), /再読み込み/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
