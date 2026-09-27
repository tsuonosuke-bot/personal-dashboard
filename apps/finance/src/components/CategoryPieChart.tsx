import { useMemo } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { categoryColor } from '../lib/chartColors'
import { amountOf, categoryLabel, isSpending, monthKey, monthLabel, yen } from '../lib/finance'
import type { Expense } from '../lib/types'

type Props = {
  expenses: Expense[]
  selectedMonth: string
}

export function CategoryPieChart({ expenses, selectedMonth }: Props) {
  const data = useMemo(() => {
    const totals = new Map<string, number>()
    for (const expense of expenses) {
      if (monthKey(expense.transaction_date) !== selectedMonth || !isSpending(expense)) continue
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + amountOf(expense))
    }

    const sorted = Array.from(totals.entries())
      .map(([categoryKey, total]) => ({ categoryKey, category: categoryLabel(categoryKey), total }))
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total)
    const primary = sorted.slice(0, 7)
    const other = sorted.slice(7).reduce((sum, item) => sum + item.total, 0)
    return other > 0 ? [...primary, { categoryKey: '__other__', category: 'その他', total: other }] : primary
  }, [expenses, selectedMonth])
  const total = data.reduce((sum, item) => sum + item.total, 0)
  const top = data[0]
  const summary = total === 0 || !top
    ? `${monthLabel(selectedMonth)}の支出データはありません。`
    : `${monthLabel(selectedMonth)}の支出は${yen.format(total)}です。最大の区分は「${top.category}」で、全体の${Math.round((top.total / total) * 100)}%です。`

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Breakdown</p>
          <h2 className="panel-title">選択月の支出内訳</h2>
        </div>
        <span className="panel-caption">{monthLabel(selectedMonth)}</span>
      </div>
      {data.length === 0 ? (
        <div className="grid h-[360px] place-items-center text-sm text-slate-500">この月の支出データはありません</div>
      ) : (
        <div role="img" aria-describedby="category-chart-summary">
          <ResponsiveContainer width="100%" height={360}>
            <PieChart>
              <Pie
                data={data}
                dataKey="total"
                nameKey="category"
                cx="50%"
                cy="46%"
                innerRadius={62}
                outerRadius={112}
                paddingAngle={2}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.categoryKey}
                    fill={entry.categoryKey === '__other__' ? '#94a3b8' : categoryColor(entry.categoryKey)}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => yen.format(Number(value))} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="chart-summary" id="category-chart-summary">{summary}</p>
    </section>
  )
}
