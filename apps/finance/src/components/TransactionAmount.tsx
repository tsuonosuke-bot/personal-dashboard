import { transactionDisplay, yen } from '../lib/finance'
import type { Expense } from '../lib/types'

/** 表・カード・取消済みで、同じ明細の区分と金額をそろえる。 */
export function TransactionAmount({ expense }: { expense: Expense }) {
  const display = transactionDisplay(expense)
  return (
    <span className="transaction-money" data-kind={display.kind}>
      <span className="transaction-kind">{display.label}</span>
      <span className="transaction-amount">{yen.format(display.amount)}</span>
    </span>
  )
}
