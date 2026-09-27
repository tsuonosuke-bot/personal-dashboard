import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Finance uses the shared dashboard shell and requested title', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
  ])
  assert.match(html, /<title>Finance — Personal Hub<\/title>/)
  assert.match(app, /<h1>Finance<\/h1>/)
  assert.match(app, /className="dashboard-switcher"/)
  assert.match(app, /<summary aria-label="ページを切り替える">/)
  assert.match(app, /className="dashboard-switcher-icon"/)
  assert.match(app, /SUPABASE LIVE/)
  assert.match(app, />Idea<\/a>/)
  assert.match(app, />Knowledge<\/a>/)
  assert.match(css, /width: min\(1240px, calc\(100% - 32px\)\)/)
  assert.match(css, /min-height: 68px/)
  assert.doesNotMatch(css, /content:\s*"▦"/)
  assert.match(css, /\.dashboard-switcher summary \{ width: 40px; min-width: 40px; height: 40px; min-height: 40px;/)
  assert.match(css, /\.recurring-button \{ width: 40px; min-width: 40px; height: 40px; min-height: 40px;/)
})

test('家計簿の登録メニューを表示し、専用APIへ送信する', async () => {
  const [app, modal, api] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ExpenseFormModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'),
  ])
  assert.match(app, /家計簿を記録/)
  assert.match(modal, /type === 'expense'/)
  assert.match(modal, /type === 'income'/)
  assert.match(modal, /type === 'offset'/)
  assert.match(modal, /支出の相殺/)
  assert.match(api, /X-Dashboard-Action.*expense-create/s)
})

test('明細行から既存値を編集し、更新専用APIへ送信する', async () => {
  const [app, modal, table, api] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ExpenseFormModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ExpenseTable.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'),
  ])
  assert.match(table, /\s編集\s/)
  assert.match(table, /onEdit\(expense\)/)
  assert.match(app, /editingExpense/)
  assert.match(modal, /家計簿を編集/)
  assert.match(modal, /Math\.abs\(Number\(expense\.amount\)\)/)
  assert.match(api, /method: 'PATCH'/)
  assert.match(api, /X-Dashboard-Action.*expense-update/s)
  assert.match(api, /original/)
})

test('明細一覧で種別・金額・日付・キーワード・並び順を組み合わせられる', async () => {
  const table = await readFile(new URL('../src/components/ExpenseTable.tsx', import.meta.url), 'utf8')
  assert.match(table, /支出・収入すべて/)
  assert.match(table, /金額 下限/)
  assert.match(table, /金額 上限/)
  assert.match(table, /amount-desc/)
  assert.match(table, /transaction_date < dateFrom/)
  assert.match(table, /expense\.category.*expense\.payer/s)
})

test('カテゴリ条件で複数選択と除外を切り替えられる', async () => {
  const [app, filter] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CategoryFilter.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(app, /filterExpensesByCategories/)
  assert.match(filter, /含める/)
  assert.match(filter, /除外する/)
  assert.match(filter, /type="checkbox"/)
  assert.match(filter, /すべて選択/)
  assert.match(filter, /すべて解除/)
  assert.match(filter, /aria-label="カテゴリをすべて選択"/)
  assert.match(app, /onSelectAll/)
})

test('月別収支推移は支出をカテゴリ別の積み上げ棒で表示する', async () => {
  const chart = await readFile(new URL('../src/components/MonthlyTrendChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /categories\.map/)
  assert.match(chart, /stackId="spending"/)
  assert.match(chart, /height=\{360\}/)
  assert.doesNotMatch(chart, /dataKey="spending"/)
})

test('棒グラフと収支線を個別に表示切り替えできる', async () => {
  const chart = await readFile(new URL('../src/components/MonthlyTrendChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /aria-label="グラフの表示切り替え"/)
  assert.match(chart, /aria-pressed=\{showBars\}/)
  assert.match(chart, /aria-pressed=\{showBalance\}/)
  assert.match(chart, /showBars && categories\.map/)
  assert.match(chart, /showBalance && <Line/)
})

test('未分類の明細を件数で知らせ、タップでカテゴリ絞り込みに切り替える', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /summarizeUnclassified\(expenses\)/)
  assert.match(app, /unclassified\.count > 0/)
  assert.match(app, /未分類の明細が\{unclassified\.count/)
  assert.match(app, /onClick=\{focusUnclassified\}/)
  assert.match(app, /setRequestedCategories\(\[UNCLASSIFIED_CATEGORY\]\)/)
  assert.match(app, /setCategoryMode\('include'\)/)
  assert.match(app, /setRequestedMonth\(unclassified\.months\[0\]\)/)
})
