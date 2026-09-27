import { useEffect, useState } from 'react'
import { categoryLabel } from '../lib/finance'
import type { BudgetCategory, RecurringExpense, RecurringExpenseDraft, RecurringExpenseUpdate, RecurringFrequency } from '../lib/types'

type Props = {
  categories: BudgetCategory[]
  rules: RecurringExpense[]
  busy: boolean
  error: string | null
  onClose: () => void
  onCreate: (draft: RecurringExpenseDraft) => Promise<boolean>
  onUpdate: (draft: RecurringExpenseUpdate) => Promise<boolean>
  onToggle: (rule: RecurringExpense) => void
  onRun: () => void
  onReload: () => void
}

type EntryType = 'expense' | 'income' | 'offset'

const frequencyLabels: Record<RecurringFrequency, string> = { daily: '毎日', weekly: '毎週', monthly: '毎月' }
const formatYen = (value: number) => `${Math.round(value).toLocaleString('ja-JP')}円`

function lastRunLabel(value: string | null) {
  if (!value) return '未生成'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('ja-JP')
}

function entryType(rule: RecurringExpense): EntryType {
  return rule.category.startsWith('80_') ? 'income' : rule.amount < 0 ? 'offset' : 'expense'
}

export function RecurringExpenseModal({ categories, rules, busy, error, onClose, onCreate, onUpdate, onToggle, onRun, onReload }: Props) {
  const [editing, setEditing] = useState<RecurringExpense | null>(null)
  const [editFrequency, setEditFrequency] = useState<RecurringFrequency>('monthly')
  const [editInterval, setEditInterval] = useState(1)
  const [editEndDate, setEditEndDate] = useState('')
  const [editType, setEditType] = useState<EntryType>('expense')
  const [editAmount, setEditAmount] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editPayer, setEditPayer] = useState('')
  const [editMemo, setEditMemo] = useState('')

  const [copying, setCopying] = useState<RecurringExpense | null>(null)
  const [copyStartDate, setCopyStartDate] = useState('')
  const [copyFrequency, setCopyFrequency] = useState<RecurringFrequency>('monthly')
  const [copyInterval, setCopyInterval] = useState(1)
  const [copyEndDate, setCopyEndDate] = useState('')
  const [copyType, setCopyType] = useState<EntryType>('expense')
  const [copyAmount, setCopyAmount] = useState('')
  const [copyTitle, setCopyTitle] = useState('')
  const [copyCategory, setCopyCategory] = useState('')
  const [copyPayer, setCopyPayer] = useState('')
  const [copyMemo, setCopyMemo] = useState('')

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [busy, onClose])

  const beginEdit = (rule: RecurringExpense) => {
    setCopying(null)
    setEditing(rule)
    setEditFrequency(rule.frequency)
    setEditInterval(rule.interval_count)
    setEditEndDate(rule.end_date ?? '')
    setEditType(entryType(rule))
    setEditAmount(String(Math.abs(rule.amount)))
    setEditTitle(rule.title)
    setEditCategory(rule.category)
    setEditPayer(rule.payer ?? '')
    setEditMemo(rule.memo ?? '')
  }

  const beginCopy = (rule: RecurringExpense) => {
    setEditing(null)
    setCopying(rule)
    setCopyStartDate(rule.next_run_date)
    setCopyFrequency(rule.frequency)
    setCopyInterval(rule.interval_count)
    setCopyEndDate(rule.end_date && rule.end_date >= rule.next_run_date ? rule.end_date : '')
    setCopyType(entryType(rule))
    setCopyAmount(String(Math.abs(rule.amount)))
    setCopyTitle(rule.title)
    setCopyCategory(rule.category)
    setCopyPayer(rule.payer ?? '')
    setCopyMemo(rule.memo ?? '')
  }

  const visibleEditCategories = categories.filter((item) => editType === 'income' ? item.name.startsWith('80_') : !item.name.startsWith('80_'))
  const selectedEditCategory = visibleEditCategories.some((item) => item.name === editCategory) ? editCategory : (visibleEditCategories[0]?.name ?? editCategory)
  const visibleCopyCategories = categories.filter((item) => copyType === 'income' ? item.name.startsWith('80_') : !item.name.startsWith('80_'))
  const selectedCopyCategory = visibleCopyCategories.some((item) => item.name === copyCategory) ? copyCategory : (visibleCopyCategories[0]?.name ?? copyCategory)

  const submitNew = (event: React.FormEvent) => {
    event.preventDefault()
    if (!copying) return
    void onCreate({
      template_rule_id: copying.id,
      start_date: copyStartDate,
      frequency: copyFrequency,
      interval_count: copyInterval,
      end_date: copyEndDate || null,
      amount: Number(copyAmount),
      title: copyTitle,
      category: selectedCopyCategory,
      payer: copyPayer.trim() || null,
      memo: copyMemo.trim() || null,
      type: copyType,
    }).then((saved) => { if (saved) setCopying(null) })
  }

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    void onUpdate({ id: editing.id, frequency: editFrequency, interval_count: editInterval, end_date: editEndDate || null, amount: Number(editAmount), title: editTitle, category: selectedEditCategory, payer: editPayer.trim() || null, memo: editMemo.trim() || null, type: editType }).then((saved) => { if (saved) setEditing(null) })
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="entry-modal recurring-modal" role="dialog" aria-modal="true" aria-labelledby="recurring-title">
      <div className="entry-modal-head"><div><p className="eyebrow">Recurring transactions</p><h2 id="recurring-title">定期登録を管理</h2></div><button type="button" className="modal-close" aria-label="家計簿へ戻る" onClick={onClose} disabled={busy}>×</button></div>
      <div className="recurring-body">
        <div className="recurring-section-head"><div><h3>登録中のルール</h3><p>毎日0:10（日本時間）にSupabaseで自動反映します。PCの電源は不要です。</p></div><button type="button" className="secondary-button" onClick={onRun} disabled={busy}>今すぐ反映</button></div>
        <div className="recurring-list">
          {rules.length === 0 && !error && <p className="recurring-empty">まだ定期登録はありません。</p>}
          {rules.map((rule) => <article className="recurring-rule" key={rule.id}>
            <div className="recurring-rule-main"><strong>{rule.title}</strong><span>{frequencyLabels[rule.frequency]}{rule.interval_count > 1 ? `（${rule.interval_count}${rule.frequency === 'monthly' ? 'か月' : rule.frequency === 'weekly' ? '週' : '日'}ごと）` : ''} · 次回 {rule.next_run_date}</span><small>{categoryLabel(rule.category)} · {formatYen(Math.abs(rule.amount))} · 最終生成 {lastRunLabel(rule.last_generated_at)}</small></div>
            <div className="recurring-rule-actions"><button type="button" className="rule-copy" onClick={() => beginCopy(rule)} disabled={busy}>複製</button><button type="button" className="rule-edit" onClick={() => beginEdit(rule)} disabled={busy}>編集</button><button type="button" className={rule.active ? 'rule-active' : 'rule-paused'} onClick={() => onToggle(rule)} disabled={busy}>{rule.active ? '有効' : '停止中'}</button></div>
          </article>)}
        </div>

        {editing && <form onSubmit={submitEdit} className="recurring-edit-form">
          <div className="recurring-section-head"><div><h3>「{editing.title}」を編集</h3><p>変更後の次回日は、今日より後の最初の予定日に再計算します。</p></div><button type="button" className="text-button" onClick={() => setEditing(null)} disabled={busy}>編集を閉じる</button></div>
          <div className="type-switch" role="group" aria-label="収支の種別"><button type="button" className={editType === 'expense' ? 'active' : ''} onClick={() => setEditType('expense')}>支出</button><button type="button" className={editType === 'income' ? 'active' : ''} onClick={() => setEditType('income')}>収入</button><button type="button" className={editType === 'offset' ? 'active' : ''} onClick={() => setEditType('offset')}>支出の相殺</button></div>
          <div className="entry-grid">
            <label className="entry-field"><span>頻度</span><select value={editFrequency} onChange={(event) => setEditFrequency(event.target.value as RecurringFrequency)}><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
            <label className="entry-field"><span>間隔</span><input type="number" min="1" max="365" value={editInterval} onChange={(event) => setEditInterval(Number(event.target.value))} required /></label>
            <label className="entry-field"><span>金額</span><input type="number" min="1" max="1000000000" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} required /></label>
            <label className="entry-field"><span>終了日（任意）</span><input type="date" min={editing.start_date} value={editEndDate} onChange={(event) => setEditEndDate(event.target.value)} /></label>
            <label className="entry-field full-field"><span>内容</span><input type="text" maxLength={200} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required /></label>
            <label className="entry-field"><span>カテゴリ</span><select value={selectedEditCategory} onChange={(event) => setEditCategory(event.target.value)} required>{visibleEditCategories.map((item) => <option key={item.id} value={item.name}>{categoryLabel(item.name)}</option>)}</select></label>
            <label className="entry-field"><span>支払者</span><input type="text" maxLength={100} value={editPayer} onChange={(event) => setEditPayer(event.target.value)} /></label>
            <label className="entry-field full-field"><span>メモ</span><textarea rows={2} maxLength={2000} value={editMemo} onChange={(event) => setEditMemo(event.target.value)} /></label>
          </div>
          {error && <p className="entry-error" role="alert">{error}</p>}
          <div className="entry-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)} disabled={busy}>キャンセル</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '保存中…' : '変更を保存'}</button></div>
        </form>}

        {copying && <form onSubmit={submitNew}>
          <div className="recurring-section-head"><div><h3>「{copying.title}」をテンプレートに追加</h3><p>内容を必要に応じて変更し、最初に明細を生成する日を指定します。</p></div><button type="button" className="text-button" onClick={() => setCopying(null)} disabled={busy}>複製を閉じる</button></div>
          <div className="type-switch" role="group" aria-label="収支の種別"><button type="button" className={copyType === 'expense' ? 'active' : ''} onClick={() => setCopyType('expense')}>支出</button><button type="button" className={copyType === 'income' ? 'active' : ''} onClick={() => setCopyType('income')}>収入</button><button type="button" className={copyType === 'offset' ? 'active' : ''} onClick={() => setCopyType('offset')}>支出の相殺</button></div>
          <div className="entry-grid">
            <label className="entry-field"><span>開始日（初回生成日）</span><input type="date" value={copyStartDate} onChange={(event) => setCopyStartDate(event.target.value)} required /></label>
            <label className="entry-field"><span>終了日（任意）</span><input type="date" min={copyStartDate} value={copyEndDate} onChange={(event) => setCopyEndDate(event.target.value)} /></label>
            <label className="entry-field"><span>頻度</span><select value={copyFrequency} onChange={(event) => setCopyFrequency(event.target.value as RecurringFrequency)}><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
            <label className="entry-field"><span>間隔</span><input type="number" min="1" max="365" value={copyInterval} onChange={(event) => setCopyInterval(Number(event.target.value))} required /></label>
            <label className="entry-field"><span>金額</span><input type="number" min="1" max="1000000000" value={copyAmount} onChange={(event) => setCopyAmount(event.target.value)} required /></label>
            <label className="entry-field"><span>カテゴリ</span><select value={selectedCopyCategory} onChange={(event) => setCopyCategory(event.target.value)} required>{visibleCopyCategories.map((item) => <option key={item.id} value={item.name}>{categoryLabel(item.name)}</option>)}</select></label>
            <label className="entry-field full-field"><span>内容</span><input type="text" maxLength={200} value={copyTitle} onChange={(event) => setCopyTitle(event.target.value)} required /></label>
            <label className="entry-field"><span>支払者</span><input type="text" maxLength={100} value={copyPayer} onChange={(event) => setCopyPayer(event.target.value)} /></label>
            <label className="entry-field full-field"><span>メモ</span><textarea rows={2} maxLength={2000} value={copyMemo} onChange={(event) => setCopyMemo(event.target.value)} /></label>
          </div>
          {error && <p className="entry-error" role="alert">{error}</p>}
          <div className="entry-actions"><button type="button" className="secondary-button" onClick={() => setCopying(null)} disabled={busy}>キャンセル</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '処理中…' : '複製して追加'}</button></div>
        </form>}

        {!editing && !copying && !error && <p className="recurring-empty">新しいルールは、登録中のルールにある「複製」から追加できます。</p>}
        {error && !editing && !copying && <div className="entry-error recurring-load-error" role="alert"><span>{error}</span><button type="button" onClick={onReload} disabled={busy}>再試行</button></div>}
        {!editing && !copying && <div className="entry-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>家計簿へ戻る</button></div>}
      </div>
    </section>
  </div>
}
