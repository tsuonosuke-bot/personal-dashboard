import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBudgetCategory, parseExpense, parsePageEnvelope } from '../src/lib/apiValidation.ts'

test('APIページ応答と家計明細を検証する', () => {
  const expense = {
    id: 5515,
    transaction_date: '2026-09-13',
    amount: 1200,
    title: '食品',
    category: '10_食費',
    payer: null,
    memo: null,
    notion_url: null,
    notion_created_at: null,
    created_at: '2026-09-13T14:40:37Z',
  }
  assert.deepEqual(parseExpense(expense), expense)
  assert.deepEqual(parsePageEnvelope({ items: [expense], total: 2624, limit: 1000, offset: 0 }), {
    items: [expense], total: 2624, limit: 1000, offset: 0,
  })
})

test('不正な明細と予算カテゴリを拒否する', () => {
  assert.throws(() => parseExpense({ id: 1 }), /明細/)
  assert.throws(() => parseBudgetCategory({ id: 1, name: 5, notion_url: null }), /予算カテゴリ/)
  assert.throws(() => parsePageEnvelope({ items: [], total: -1, limit: 1000, offset: 0 }), /total/)
})

test('予算カテゴリを受け入れる', () => {
  const category = { id: 1, name: '10_食費', notion_url: null }
  assert.deepEqual(parseBudgetCategory(category), category)
})

test('categoryが欠けた明細は未分類として受け入れる', () => {
  const base = {
    id: 5540,
    transaction_date: '2026-08-23',
    amount: 2448,
    title: 'AMAZON.CO.JP',
    payer: '共同',
    memo: '楽天カードCSV自動インポート',
    notion_url: null,
    notion_created_at: null,
    created_at: '2026-09-19T11:28:36Z',
  }
  assert.equal(parseExpense({ ...base, category: null }).category, '97_未分類')
  assert.equal(parseExpense({ ...base, category: '  ' }).category, '97_未分類')
  assert.equal(parseExpense(base).category, '97_未分類')
  assert.throws(() => parseExpense({ ...base, category: 5 }), /category/)
})
