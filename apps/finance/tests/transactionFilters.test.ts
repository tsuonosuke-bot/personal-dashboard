import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')

test('月・カテゴリ・支払者を変えても明細表を作り直さず、月の外を指す期間だけを理由つきで解除する', async () => {
  const [app, table] = await Promise.all([read('../src/App.tsx'), read('../src/components/ExpenseTable.tsx')])
  assert.doesNotMatch(app, /<ExpenseTable\s+key=/)
  assert.match(app, /scopeKey=\{`\$\{selectedMonth\}:\$\{categoryMode\}/)
  assert.match(table, /previousScope\.month !== selectedMonth/)
  assert.match(table, /monthKey\(dateFrom\) !== selectedMonth/)
  assert.match(table, /月の外を指していた期間/)
  assert.match(table, /role="status"/)
  // 検索・種別・金額・並び順は集計条件の変更で触らない
  const scopeBlock = table.slice(table.indexOf('if (previousScope.key'), table.indexOf('const monthExpenses'))
  assert.doesNotMatch(scopeBlock, /setQuery|setType|setAmountMin|setAmountMax|setSort/)
})

test('スマホでは検索を常設し、詳細条件を開閉式にして適用中の件数を示す', async () => {
  const [table, styles] = await Promise.all([read('../src/components/ExpenseTable.tsx'), read('../src/index.css')])
  assert.match(table, /className="filter-details-toggle"/)
  assert.match(table, /aria-expanded=\{detailsOpen\}/)
  assert.match(table, /件適用中/)
  assert.ok(table.indexOf('filter-search') < table.indexOf('filter-details-toggle'))
  assert.match(styles, /\.filter-details-toggle \{ display: none; \}/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.transaction-filter-details\[data-open="false"\] \{ display: none; \}/)
})

test('カテゴリの一括操作ボタンは44pxのタッチ領域を持ち、スマホでは2列に並ぶ', async () => {
  const styles = await read('../src/index.css')
  assert.match(styles, /\.category-filter-footer button \{ min-height: 44px;/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.category-filter-actions \{ display: grid; grid-template-columns: 1fr 1fr;/)
})
