import { UNCLASSIFIED_CATEGORY } from './finance.ts'
import type { BudgetCategory, Expense, RecurringExpense } from './types'

type PageEnvelope = {
  items: unknown[]
  total: number | null
  limit: number
  offset: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(entity: string, field?: string): never {
  throw new Error(`APIから受信した${entity}${field ? `の${field}` : ''}が正しくありません。`)
}

function stringValue(record: Record<string, unknown>, field: string, entity: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : fail(entity, field)
}

function nullableStringValue(record: Record<string, unknown>, field: string, entity: string): string | null {
  const value = record[field]
  return value === null || typeof value === 'string' ? value : fail(entity, field)
}

function categoryValue(record: Record<string, unknown>, entity: string): string {
  const value = record.category
  // categoryはDB上NULLを許すため、欠けていても一覧全体を落とさず未分類として扱う。
  if (value === null || value === undefined) return UNCLASSIFIED_CATEGORY
  if (typeof value !== 'string') return fail(entity, 'category')
  return value.trim() || UNCLASSIFIED_CATEGORY
}

function numberValue(record: Record<string, unknown>, field: string, entity: string): number {
  const value = record[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : fail(entity, field)
}

function nullableNumberValue(record: Record<string, unknown>, field: string, entity: string): number | null {
  const value = record[field]
  return value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : fail(entity, field)
}

function booleanValue(record: Record<string, unknown>, field: string, entity: string): boolean {
  const value = record[field]
  return typeof value === 'boolean' ? value : fail(entity, field)
}

export function parsePageEnvelope(value: unknown): PageEnvelope {
  if (!isRecord(value) || !Array.isArray(value.items)) return fail('ページ応答')
  const { total, limit, offset } = value
  if (total !== null && (!Number.isSafeInteger(total) || (total as number) < 0)) return fail('ページ応答', 'total')
  if (!Number.isSafeInteger(limit) || (limit as number) < 1) return fail('ページ応答', 'limit')
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) return fail('ページ応答', 'offset')
  return { items: value.items, total: total as number | null, limit: limit as number, offset: offset as number }
}

export function parseExpense(value: unknown): Expense {
  const entity = '明細'
  if (!isRecord(value)) return fail(entity)
  const transactionDate = stringValue(value, 'transaction_date', entity)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return fail(entity, 'transaction_date')
  return {
    id: numberValue(value, 'id', entity),
    transaction_date: transactionDate,
    amount: numberValue(value, 'amount', entity),
    title: stringValue(value, 'title', entity),
    category: categoryValue(value, entity),
    payer: nullableStringValue(value, 'payer', entity),
    memo: nullableStringValue(value, 'memo', entity),
    notion_url: nullableStringValue(value, 'notion_url', entity),
    notion_created_at: nullableStringValue(value, 'notion_created_at', entity),
    created_at: stringValue(value, 'created_at', entity),
  }
}

export function parseBudgetCategory(value: unknown): BudgetCategory {
  const entity = '予算カテゴリ'
  if (!isRecord(value)) return fail(entity)
  return {
    id: numberValue(value, 'id', entity),
    name: stringValue(value, 'name', entity),
    notion_url: nullableStringValue(value, 'notion_url', entity),
  }
}

export function parseRecurringExpense(value: unknown): RecurringExpense {
  const entity = '定期登録'
  if (!isRecord(value)) return fail(entity)
  const frequency = stringValue(value, 'frequency', entity)
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') return fail(entity, 'frequency')
  return {
    id: numberValue(value, 'id', entity),
    source_expense_id: nullableNumberValue(value, 'source_expense_id', entity),
    template_rule_id: nullableNumberValue(value, 'template_rule_id', entity),
    frequency,
    interval_count: numberValue(value, 'interval_count', entity),
    day_of_month: numberValue(value, 'day_of_month', entity),
    start_date: stringValue(value, 'start_date', entity),
    end_date: nullableStringValue(value, 'end_date', entity),
    next_run_date: stringValue(value, 'next_run_date', entity),
    active: booleanValue(value, 'active', entity),
    amount: numberValue(value, 'amount', entity),
    title: stringValue(value, 'title', entity),
    category: stringValue(value, 'category', entity),
    payer: nullableStringValue(value, 'payer', entity),
    memo: nullableStringValue(value, 'memo', entity),
    last_generated_at: nullableStringValue(value, 'last_generated_at', entity),
    created_at: stringValue(value, 'created_at', entity),
    updated_at: stringValue(value, 'updated_at', entity),
  }
}
