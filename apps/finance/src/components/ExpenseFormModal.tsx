import { useEffect, useMemo, useState } from 'react'
import { categoryLabel } from '../lib/finance'
import type { BudgetCategory, Expense, ExpenseDraft } from '../lib/types'

type Props = {
  categories: BudgetCategory[]
  payers: string[]
  saving: boolean
  error: string | null
  expense?: Expense
  onClose: () => void
  onSave: (draft: ExpenseDraft) => void
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function ExpenseFormModal({ categories, payers, saving, error, expense, onClose, onSave }: Props) {
  const editing = Boolean(expense)
  const [type, setType] = useState<'expense' | 'income' | 'offset'>(() => {
    if (expense?.category.startsWith('80_')) return 'income'
    return expense && Number(expense.amount) < 0 ? 'offset' : 'expense'
  })
  const [date, setDate] = useState(() => expense?.transaction_date ?? todayKey())
  const [amount, setAmount] = useState(() => expense ? String(Math.abs(Number(expense.amount))) : '')
  const [title, setTitle] = useState(() => expense?.title ?? '')
  const [category, setCategory] = useState(() => expense?.category ?? '')
  const [payer, setPayer] = useState(() => expense?.payer ?? '')
  const [memo, setMemo] = useState(() => expense?.memo ?? '')

  const visibleCategories = useMemo(() => {
    const matching = categories.filter((item) => type === 'income' ? item.name.startsWith('80_') : !item.name.startsWith('80_'))
    return matching.length ? matching : categories
  }, [categories, type])

  const selectedCategory = visibleCategories.some((item) => item.name === category)
    ? category
    : (visibleCategories[0]?.name || '')

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose, saving])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    onSave({
      transaction_date: date,
      amount: Number(amount),
      title,
      category: selectedCategory,
      payer: payer.trim() || null,
      memo: memo.trim() || null,
      type,
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
        <div className="entry-modal-head">
          <div><p className="eyebrow">{editing ? 'Edit transaction' : 'New transaction'}</p><h2 id="expense-modal-title">{editing ? '家計簿を編集' : '家計簿を記録'}</h2></div>
          <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose} disabled={saving}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="type-switch" role="group" aria-label="収支の種別">
            <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>支出</button>
            <button type="button" className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>収入</button>
            <button type="button" className={type === 'offset' ? 'active' : ''} onClick={() => setType('offset')}>支出の相殺</button>
          </div>
          <div className="entry-grid">
            <label className="entry-field"><span>日付 <b>必須</b></span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label className="entry-field"><span>金額 <b>必須</b></span><div className="amount-field"><span>¥</span><input type="number" min="1" max="1000000000" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" autoFocus required /></div></label>
            <label className="entry-field full-field"><span>内容 <b>必須</b></span><input type="text" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例: スーパー、給与" required /></label>
            <label className="entry-field"><span>カテゴリ <b>必須</b></span><select value={selectedCategory} onChange={(event) => setCategory(event.target.value)} required>{visibleCategories.map((item) => <option key={item.id} value={item.name}>{categoryLabel(item.name)}</option>)}</select></label>
            <label className="entry-field"><span>支払者</span><input type="text" maxLength={100} list="payer-options" value={payer} onChange={(event) => setPayer(event.target.value)} placeholder="任意" /><datalist id="payer-options">{payers.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label className="entry-field full-field"><span>メモ</span><textarea rows={3} maxLength={2000} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="任意" /></label>
          </div>
          {error && <p className="entry-error" role="alert">{error}</p>}
          <div className="entry-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>キャンセル</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : editing ? '変更を保存' : '保存する'}</button></div>
        </form>
      </section>
    </div>
  )
}
