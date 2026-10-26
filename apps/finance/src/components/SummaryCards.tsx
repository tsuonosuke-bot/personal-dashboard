import { useMemo } from 'react'
import {
  monthLabel,
  yen,
} from '../lib/finance'
import { summaryFromAggregates, type CumulativeTotals, type MonthlyAggregate } from '../lib/financeOverview'

type Props = {
  monthly: MonthlyAggregate[]
  selectedMonth: string
  cumulative: CumulativeTotals | null
}

export function SummaryCards({ monthly, selectedMonth, cumulative }: Props) {
  const summary = useMemo(() => summaryFromAggregates(monthly, selectedMonth), [monthly, selectedMonth])
  const balanceChangeLabel = summary.balanceDiff === 0
    ? '前月と同額'
    : `${yen.format(Math.abs(summary.balanceDiff))}${summary.balanceDiff > 0 ? '増' : '減'}`
  const cumulativeBalance = cumulative ? cumulative.income - cumulative.spending : 0
  const signedYen = (amount: number) => `${amount >= 0 ? '+' : ''}${yen.format(amount)}`

  return (
    <section className="summary-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${monthLabel(selectedMonth)}の概要`}>
      <div className="summary-card border-l-4 border-l-indigo-500">
        <p className="summary-label">選択月の支出</p>
        <p className="summary-value">{yen.format(summary.spending)}</p>
        <p className="summary-note">{monthLabel(summary.selectedMonth)}</p>
      </div>
      <div className="summary-card border-l-4 border-l-sky-500">
        <p className="summary-label">選択月の収入</p>
        <p className="summary-value text-sky-700">{yen.format(summary.income)}</p>
        <p className="summary-note">{monthLabel(summary.selectedMonth)}</p>
      </div>
      <div className="summary-card border-l-4 border-l-emerald-500">
        <p className="summary-label">選択月の収支</p>
        <p className={`summary-value ${summary.balance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {summary.balance >= 0 ? '+' : ''}{yen.format(summary.balance)}
        </p>
        <p className="summary-note">収入 − 支出</p>
      </div>
      <div className="summary-card border-l-4 border-l-amber-500">
        <p className="summary-label">収支前月比</p>
        <p className={`summary-value ${summary.balanceDiff >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {balanceChangeLabel}
        </p>
        <p className="summary-note">
          前月収支 {signedYen(summary.previousMonthBalance)} → 今月収支 {signedYen(summary.balance)}
        </p>
      </div>
      {cumulative && (
        <div className="summary-card border-l-4 border-l-violet-500 sm:col-span-2 xl:col-span-4">
          <p className="summary-label">累計収支</p>
          <p className={`summary-value ${cumulativeBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {signedYen(cumulativeBalance)}
          </p>
          <p className="summary-note">
            {monthLabel(cumulative.since)}〜{monthLabel(summary.selectedMonth)} · 収入 {yen.format(cumulative.income)} − 支出 {yen.format(cumulative.spending)}
          </p>
        </div>
      )}
    </section>
  )
}
