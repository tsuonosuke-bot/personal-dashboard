export const CATEGORY_COLORS = [
  '#4f46e5',
  '#0891b2',
  '#0d9488',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#7c3aed',
  '#2563eb',
  '#475569',
  '#16a34a',
  '#c026d3',
  '#e11d48',
  '#0f766e',
]

export function categoryColor(category: string) {
  const code = category.match(/^(\d+)_/)?.[1]
  if (code) return CATEGORY_COLORS[(Math.max(1, Number(code)) - 1) % CATEGORY_COLORS.length]

  let hash = 0
  for (const character of category) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length]
}
