import type { Expense } from './types'
import type { BulkCategoryResponse } from './api'
import type { BulkCategoryResult } from '../components/BulkCategoryBar'

export async function runCategoryBatches(targets: Expense[], category: string,
  hooks: { shouldStop(): boolean; onProgress(done: number): void; onUpdated(rows: Expense[]): void },
  save: (rows: Expense[], category: string) => Promise<BulkCategoryResponse[]>): Promise<BulkCategoryResult> {
  const result: BulkCategoryResult = { updated: [], conflicts: [], failed: [], skipped: [] }
  for (let offset = 0; offset < targets.length; offset += 25) {
    if (hooks.shouldStop()) { result.skipped.push(...targets.slice(offset).map((row) => row.id)); break }
    const chunk = targets.slice(offset, offset + 25)
    try {
      const outcomes = await save(chunk, category)
      const updated: Expense[] = []
      for (const item of outcomes) {
        if (item.status === 'updated') { result.updated.push(item.id); if (item.item) updated.push(item.item) }
        else if (item.status === 'conflict') result.conflicts.push(item.id)
        else result.failed.push(item.id)
      }
      if (updated.length) hooks.onUpdated(updated)
    } catch { result.failed.push(...chunk.map((row) => row.id)) }
    hooks.onProgress(Math.min(offset + chunk.length, targets.length))
  }
  return result
}
