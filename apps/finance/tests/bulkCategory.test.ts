import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')

test('APIのエラーはstatusを持ち、一括変更で他画面の更新（409）を見分けられる', async () => {
  const api = await read('../src/lib/api.ts')
  assert.match(api, /export class ApiError extends Error \{\n  readonly status: number/)
  assert.match(api, /throw new ApiError\(message, response\.status\)/)
})

test('未分類だけを複数選択し、変更先と件数・合計を確認してから1件ずつ更新する', async () => {
  const [table, bar, app] = await Promise.all([
    read('../src/components/ExpenseTable.tsx'),
    read('../src/components/BulkCategoryBar.tsx'),
    read('../src/App.tsx'),
  ])
  assert.match(table, /expense\.category === UNCLASSIFIED_CATEGORY/)
  assert.match(table, /このページの未分類をすべて選択/)
  assert.match(bar, /変更内容を確認/)
  assert.match(bar, /件<\/strong>の未分類を「/)
  assert.match(bar, /金額合計/)
  assert.match(bar, /setPhase\('select'\)}>戻る<\/button>/)
  // 収入カテゴリへは符号が変わるので一括変更の候補に出さない
  assert.match(bar, /!item\.name\.startsWith\('80_'\)/)
  // 1件ずつ編集APIを使い、編集前の値を条件にする（他画面の更新を上書きしない）
  assert.match(app, /for \(const \[index, expense\] of targets\.entries\(\)\)/)
  assert.match(app, /await updateExpense\(expense, \{/)
  assert.match(app, /caught instanceof ApiError && caught\.status === 409/)
  assert.match(app, /type: amount < 0 \? 'offset' : 'expense'/)
})

test('途中で中止でき、変更できなかった明細は理由つきで選択したまま残す', async () => {
  const [table, bar] = await Promise.all([read('../src/components/ExpenseTable.tsx'), read('../src/components/BulkCategoryBar.tsx')])
  assert.match(bar, /stopRequested\.current = true/)
  assert.match(bar, /件は中止したため変更していません/)
  assert.match(bar, /件は別の画面で更新されていたため変更していません/)
  assert.match(bar, /件は保存に失敗しました/)
  assert.match(table, /new Set\(\[\.\.\.result\.conflicts, \.\.\.result\.failed, \.\.\.result\.skipped\]\)/)
})
