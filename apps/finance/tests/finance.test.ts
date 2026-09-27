import assert from 'node:assert/strict'
import test from 'node:test'
import { CATEGORY_COLORS, categoryColor } from '../src/lib/chartColors.ts'
import { buildMonthlyTrendData, filterExpensesByCategories, filterExpensesByCategory, filterExpensesByPayer, isIncome, isSpending, summarizeMonth, summarizeUnclassified } from '../src/lib/finance.ts'
import type { Expense } from '../src/lib/types.ts'

const expenses: Expense[] = [
  {
    id: 1,
    transaction_date: '2026-09-01',
    amount: 1200,
    title: '昼食',
    category: '10_食費',
    payer: '健介',
    memo: null,
    notion_url: null,
    notion_created_at: null,
    created_at: '2026-09-01',
  },
  {
    id: 2,
    transaction_date: '2026-09-02',
    amount: 3000,
    title: '電車',
    category: '20_交通費',
    payer: '家族',
    memo: null,
    notion_url: null,
    notion_created_at: null,
    created_at: '2026-09-02',
  },
]

test('カテゴリ未選択では全明細を返す', () => {
  assert.equal(filterExpensesByCategory(expenses, ''), expenses)
})

test('カテゴリキーが完全一致する明細だけを返す', () => {
  assert.deepEqual(filterExpensesByCategory(expenses, '10_食費').map((expense) => expense.id), [1])
})

test('該当カテゴリがなければ空配列を返す', () => {
  assert.deepEqual(filterExpensesByCategory(expenses, '99_その他'), [])
})

test('複数カテゴリをまとめて含められる', () => {
  assert.deepEqual(
    filterExpensesByCategories(expenses, ['10_食費', '20_交通費'], 'include').map((expense) => expense.id),
    [1, 2],
  )
})

test('選択した複数カテゴリを除外できる', () => {
  assert.deepEqual(
    filterExpensesByCategories(expenses, ['20_交通費'], 'exclude').map((expense) => expense.id),
    [1],
  )
  assert.equal(filterExpensesByCategories(expenses, [], 'exclude'), expenses)
})

test('支払者未選択では全明細を返す', () => {
  assert.equal(filterExpensesByPayer(expenses, ''), expenses)
})

test('選択した支払者の明細だけを返す', () => {
  assert.deepEqual(filterExpensesByPayer(expenses, '家族').map((expense) => expense.id), [2])
})

test('カテゴリと支払者のフィルターを組み合わせられる', () => {
  const byCategory = filterExpensesByCategory(expenses, '10_食費')
  assert.deepEqual(filterExpensesByPayer(byCategory, '健介').map((expense) => expense.id), [1])
  assert.deepEqual(filterExpensesByPayer(byCategory, '家族'), [])
})

test('月別推移の支出をカテゴリ別の積み上げデータにする', () => {
  const trendExpenses: Expense[] = [
    ...expenses,
    { ...expenses[0], id: 3, amount: -100000, category: '80_収入' },
    { ...expenses[0], id: 4, transaction_date: '2025-01-01', category: '99_期間外' },
  ]
  const { categories, data } = buildMonthlyTrendData(trendExpenses, '2026-09')
  const september = data.find((item) => item.month === '2026-09')

  assert.deepEqual(categories, ['10_食費', '20_交通費'])
  assert.equal(september?.['10_食費'], 1200)
  assert.equal(september?.['20_交通費'], 3000)
  assert.equal(september?.income, 100000)
  assert.equal(september?.balance, 95800)
})

test('非収入カテゴリの負額は収入ではなく支出の相殺として扱う', () => {
  const offset = {
    ...expenses[0],
    id: 3,
    amount: -11322,
    category: '40_旅行費用',
    title: 'むつみぶん',
  }

  assert.equal(isIncome(offset), false)
  assert.equal(isSpending(offset), true)
})

test('7月の旅行費用を負額明細で相殺し、収入には含めない', () => {
  const julyExpenses: Expense[] = [
    {
      ...expenses[0],
      id: 10,
      transaction_date: '2026-07-27',
      amount: 302180,
      category: '40_旅行費用',
      title: '飛行機、ホテル',
    },
    {
      ...expenses[0],
      id: 11,
      transaction_date: '2026-07-27',
      amount: -11322,
      category: '40_旅行費用',
      title: 'むつみぶん',
    },
    {
      ...expenses[0],
      id: 12,
      transaction_date: '2026-07-27',
      amount: -12529,
      category: '40_旅行費用',
      title: 'けんすけぶん',
    },
    {
      ...expenses[0],
      id: 13,
      transaction_date: '2026-07-25',
      amount: -487563,
      category: '80_収入',
      title: '給料 (4)',
    },
  ]

  const summary = summarizeMonth(julyExpenses, '2026-07')
  const { data } = buildMonthlyTrendData(julyExpenses, '2026-07')
  const july = data.find((item) => item.month === '2026-07')

  assert.equal(summary.spending, 278329)
  assert.equal(summary.income, 487563)
  assert.equal(summary.balance, 209234)
  assert.equal(july?.['40_旅行費用'], 278329)
  assert.equal(july?.income, 487563)
  assert.equal(july?.balance, 209234)

  const withoutIncome = filterExpensesByCategories(julyExpenses, ['80_収入'], 'exclude')
  const filteredSummary = summarizeMonth(withoutIncome, '2026-07')
  assert.equal(filteredSummary.spending, 278329)
  assert.equal(filteredSummary.income, 0)
})

test('カテゴリ色は表示中の組み合わせに左右されない', () => {
  assert.equal(categoryColor('01_食費'), CATEGORY_COLORS[0])
  assert.equal(categoryColor('03_住居費'), CATEGORY_COLORS[2])
  assert.notEqual(categoryColor('01_食費'), categoryColor('03_住居費'))
})

test('収支前月比は各月の収入と支出の差を比較する', () => {
  const comparisonExpenses: Expense[] = [
    ...expenses,
    { ...expenses[0], id: 3, transaction_date: '2026-08-10', amount: 5000 },
    { ...expenses[0], id: 4, transaction_date: '2026-08-25', amount: -500000, category: '80_収入' },
    { ...expenses[0], id: 5, transaction_date: '2026-09-25', amount: -600000, category: '80_収入' },
  ]

  const summary = summarizeMonth(comparisonExpenses, '2026-09')

  assert.equal(summary.spending, 4200)
  assert.equal(summary.income, 600000)
  assert.equal(summary.balance, 595800)
  assert.equal(summary.previousMonthSpending, 5000)
  assert.equal(summary.previousMonthIncome, 500000)
  assert.equal(summary.previousMonthBalance, 495000)
  assert.equal(summary.balanceDiff, 100800)
})

test('未分類の明細の件数と該当月を新しい順に集計する', () => {
  const unclassified = (id: number, transactionDate: string, category: string): Expense => ({
    ...expenses[0], id, transaction_date: transactionDate, category,
  })
  const rows = [
    unclassified(11, '2026-08-23', '97_未分類'),
    unclassified(12, '2026-08-10', '97_未分類'),
    unclassified(13, '2026-07-02', '97_未分類'),
    unclassified(14, '2026-08-15', '01_食費'),
  ]
  assert.deepEqual(summarizeUnclassified(rows), { count: 3, months: ['2026-08', '2026-07'] })
  assert.deepEqual(summarizeUnclassified(expenses), { count: 0, months: [] })
})
