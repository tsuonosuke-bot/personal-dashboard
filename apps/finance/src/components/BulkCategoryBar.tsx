import { useRef, useState } from 'react'
import { categoryLabel, UNCLASSIFIED_CATEGORY, yen } from '../lib/finance'
import type { BudgetCategory, Expense } from '../lib/types'

export type BulkCategoryResult = {
  updated: number[]
  conflicts: number[]
  failed: number[]
  skipped: number[]
}

type Props = {
  selected: Expense[]
  categories: BudgetCategory[]
  disabled: boolean
  onRun: (targets: Expense[], category: string, hooks: { shouldStop: () => boolean; onProgress: (done: number) => void }) => Promise<BulkCategoryResult>
  onFinished: (result: BulkCategoryResult) => void
  onClearSelection: () => void
}

const PREVIEW_LIMIT = 5

function resultMessage(result: BulkCategoryResult, category: string) {
  const parts = [`${result.updated.length}件を「${categoryLabel(category)}」に変更しました。`]
  if (result.conflicts.length) parts.push(`${result.conflicts.length}件は別の画面で更新されていたため変更していません。再読み込みして確認してください。`)
  if (result.failed.length) parts.push(`${result.failed.length}件は保存に失敗しました。時間をおいて再実行してください。`)
  if (result.skipped.length) parts.push(`${result.skipped.length}件は中止したため変更していません。`)
  if (result.conflicts.length + result.failed.length + result.skipped.length > 0) parts.push('変更できなかった明細は選択したままにしています。')
  return parts.join('')
}

// 未分類の明細を複数選んで、確認してから1件ずつカテゴリを変更する。収入（80_）への変更は符号が変わるため1件ずつ編集してもらう。
export function BulkCategoryBar({ selected, categories, disabled, onRun, onFinished, onClearSelection }: Props) {
  const options = categories.filter((item) => item.name !== UNCLASSIFIED_CATEGORY && !item.name.startsWith('80_'))
  const [category, setCategory] = useState('')
  const [phase, setPhase] = useState<'select' | 'confirm' | 'running'>('select')
  const [progress, setProgress] = useState(0)
  // 実行中は変更済みの行が選択から外れていくので、開始時の件数を持っておく
  const [runTotal, setRunTotal] = useState(0)
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const stopRequested = useRef(false)
  const chosen = options.some((item) => item.name === category) ? category : ''

  if (selected.length === 0 && phase !== 'running') {
    return message ? <p className={`bulk-category-result ${message.tone}`} role="status"><span>{message.text}</span><button type="button" aria-label="結果を閉じる" onClick={() => setMessage(null)}>×</button></p> : null
  }

  const total = selected.reduce((sum, expense) => sum + Math.abs(Number(expense.amount)), 0)

  const run = async () => {
    if (!chosen) return
    const targets = selected
    stopRequested.current = false
    setProgress(0)
    setRunTotal(targets.length)
    setPhase('running')
    const result = await onRun(targets, chosen, { shouldStop: () => stopRequested.current, onProgress: setProgress })
    setPhase('select')
    const incomplete = result.conflicts.length + result.failed.length + result.skipped.length
    setMessage({ text: resultMessage(result, chosen), tone: incomplete ? 'warn' : 'ok' })
    onFinished(result)
  }

  return (
    <div className="bulk-category" aria-live="polite">
      {phase === 'select' && (
        <div className="bulk-category-row">
          <strong>{selected.length.toLocaleString('ja-JP')}件を選択中</strong>
          <label>
            <span>変更先カテゴリ</span>
            <select value={chosen} onChange={(event) => setCategory(event.target.value)} disabled={disabled}>
              <option value="">選択してください</option>
              {options.map((item) => <option key={item.id} value={item.name}>{categoryLabel(item.name)}</option>)}
            </select>
          </label>
          <button type="button" className="primary-button" onClick={() => { setMessage(null); setPhase('confirm') }} disabled={disabled || !chosen}>変更内容を確認</button>
          <button type="button" className="text-button" onClick={onClearSelection} disabled={disabled}>選択を解除</button>
        </div>
      )}
      {phase === 'confirm' && (
        <div className="bulk-category-confirm" role="group" aria-label="一括変更の確認">
          <p><strong>{selected.length.toLocaleString('ja-JP')}件</strong>の未分類を「<strong>{categoryLabel(chosen)}</strong>」に変更します（金額合計 {yen.format(total)}）。</p>
          <ul>
            {selected.slice(0, PREVIEW_LIMIT).map((expense) => <li key={expense.id}><span>{expense.transaction_date}</span><span>{expense.title}</span><span>{yen.format(Number(expense.amount))}</span></li>)}
          </ul>
          {selected.length > PREVIEW_LIMIT && <p className="bulk-category-more">ほか{(selected.length - PREVIEW_LIMIT).toLocaleString('ja-JP')}件</p>}
          <p className="bulk-category-note">1件ずつ保存します。別の画面で更新された明細は上書きせずに残します。</p>
          <div className="entry-actions">
            <button type="button" className="secondary-button" onClick={() => setPhase('select')}>戻る</button>
            <button type="button" className="primary-button" onClick={() => void run()}>{selected.length.toLocaleString('ja-JP')}件を変更する</button>
          </div>
        </div>
      )}
      {phase === 'running' && (
        <div className="bulk-category-row" role="status">
          <strong>変更中… {progress.toLocaleString('ja-JP')} / {runTotal.toLocaleString('ja-JP')}件</strong>
          <button type="button" className="secondary-button" onClick={() => { stopRequested.current = true }}>中止</button>
        </div>
      )}
      {message && phase === 'select' && <p className={`bulk-category-result ${message.tone}`} role="status"><span>{message.text}</span><button type="button" aria-label="結果を閉じる" onClick={() => setMessage(null)}>×</button></p>}
    </div>
  )
}
