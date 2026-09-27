import { useMemo, useState } from 'react'
import type { TooltipContentProps } from 'recharts'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { categoryColor } from '../lib/chartColors'
import { buildMonthlyTrendData, categoryLabel, monthLabel, yen } from '../lib/finance'
import type { Expense } from '../lib/types'

type Props = {
  expenses: Expense[]
  selectedMonth: string
}

function TrendTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.filter((entry) => Number(entry.value) !== 0)
  if (rows.length === 0) return null

  return (
    <div className="trend-tooltip">
      <p className="trend-tooltip-label">{monthLabel(String(label))}</p>
      <div className="trend-tooltip-rows">
        {rows.map((entry) => (
          <p key={String(entry.dataKey)} className="trend-tooltip-row">
            <span>
              <i style={{ background: entry.color }} />
              {entry.name}
            </span>
            <b>{yen.format(Number(entry.value))}</b>
          </p>
        ))}
      </div>
    </div>
  )
}

export function MonthlyTrendChart({ expenses, selectedMonth }: Props) {
  const [showBars, setShowBars] = useState(true)
  const [showBalance, setShowBalance] = useState(true)
  const { categories, data } = useMemo(
    () => buildMonthlyTrendData(expenses, selectedMonth),
    [expenses, selectedMonth],
  )
  const current = data.at(-1)
  const previous = data.at(-2)
  const spending = (row: typeof current) => row
    ? categories.reduce((sum, category) => sum + Number(row[category] ?? 0), 0)
    : 0
  const currentSpending = spending(current)
  const previousSpending = spending(previous)
  const spendingChange = currentSpending - previousSpending
  const changeText = spendingChange === 0
    ? '前月と同額です'
    : `前月より${yen.format(Math.abs(spendingChange))}${spendingChange > 0 ? '増えています' : '減っています'}`
  const summary = !current || (currentSpending === 0 && Number(current.income) === 0)
    ? `${monthLabel(selectedMonth)}には比較できる収支データがありません。`
    : `${monthLabel(selectedMonth)}は支出${yen.format(currentSpending)}、収入${yen.format(Number(current.income))}、収支${yen.format(Number(current.balance))}です。支出は${changeText}。`

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Cash flow</p>
          <h2 className="panel-title">月別収支推移</h2>
        </div>
        <div className="trend-heading-actions">
          <span className="panel-caption">〜 {monthLabel(selectedMonth)}</span>
          <div className="chart-series-toggles" role="group" aria-label="グラフの表示切り替え">
            <button
              type="button"
              aria-pressed={showBars}
              onClick={() => setShowBars((visible) => !visible)}
            >
              <i className="bar-toggle-mark" aria-hidden="true" />
              棒グラフ
            </button>
            <button
              type="button"
              aria-pressed={showBalance}
              onClick={() => setShowBalance((visible) => !visible)}
            >
              <i className="line-toggle-mark" aria-hidden="true" />
              収支線
            </button>
          </div>
        </div>
      </div>
      <div className="trend-legend" aria-label="月別収支推移の凡例">
        {showBars && categories.map((category) => (
          <span key={category} className="trend-legend-item" aria-label={`支出カテゴリ ${categoryLabel(category)}`}>
            <i style={{ background: categoryColor(category) }} />
            {categoryLabel(category)}
          </span>
        ))}
        {showBars && <span className="trend-legend-item"><i className="income-legend" />収入</span>}
        {showBalance && <span className="trend-legend-item"><i className="balance-legend" />収支</span>}
        {!showBars && !showBalance && <span className="trend-legend-empty">表示するグラフを選択してください</span>}
      </div>
      {showBars || showBalance ? (
        <div role="img" aria-describedby="monthly-trend-summary">
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={data} barCategoryGap="18%" margin={{ top: 16, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} tick={{ fontSize: 12 }} />
            <Tooltip content={TrendTooltip} allowEscapeViewBox={{ x: false, y: false }} />
            {showBars && categories.map((category, index) => (
              <Bar
                key={category}
                dataKey={category}
                name={categoryLabel(category)}
                stackId="spending"
                fill={categoryColor(category)}
                maxBarSize={34}
                radius={index === categories.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
            {showBars && <Bar dataKey="income" name="収入" fill="#38bdf8" maxBarSize={34} radius={[4, 4, 0, 0]} />}
            {showBalance && <Line type="monotone" dataKey="balance" name="収支" stroke="#059669" strokeWidth={2} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="trend-chart-empty">グラフ表示がオフです</div>
      )}
      <p className="chart-summary" id="monthly-trend-summary">{summary}</p>
    </section>
  )
}
