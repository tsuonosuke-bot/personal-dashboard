import type { BudgetCategory, Expense } from './types'

export const demoCategories: BudgetCategory[] = [
  { id: 1, name: '01_食費', notion_url: null },
  { id: 2, name: '03_住居費', notion_url: null },
  { id: 3, name: '04_交通費', notion_url: null },
  { id: 4, name: '08_趣味・娯楽', notion_url: null },
  { id: 5, name: '16_雑費', notion_url: null },
  { id: 6, name: '80_収入', notion_url: null },
]

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function createDemoExpenses(now = new Date()): Expense[] {
  const rows: Expense[] = []
  let id = 1

  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const year = date.getFullYear()
    const month = date.getMonth()
    const seasonal = (11 - offset) * 850
    const values = [
      { day: 3, amount: 42000 + seasonal, title: '食料品・日用品', category: '01_食費' },
      { day: 5, amount: 86000, title: '住居費', category: '03_住居費' },
      { day: 12, amount: 9800 + offset * 140, title: '交通費', category: '04_交通費' },
      { day: 18, amount: 12500 + (offset % 3) * 3200, title: '余暇・レジャー', category: '08_趣味・娯楽' },
      { day: 25, amount: -380000 - (offset % 4) * 5000, title: '給与', category: '80_収入' },
    ]

    for (const value of values) {
      rows.push({
        id,
        transaction_date: dateKey(year, month, value.day),
        amount: value.amount,
        title: value.title,
        category: value.category,
        payer: 'サンプル',
        memo: 'デモ表示用データ',
        notion_url: null,
        notion_created_at: null,
        created_at: dateKey(year, month, value.day),
      })
      id += 1
    }
  }

  return rows.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
}
