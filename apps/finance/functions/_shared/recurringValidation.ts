import { jsonResponse } from './supabaseRest.ts'

const MAX_REQUEST_CHARS = 2_000

export function validateRecurringRequest(request: Request, action: string): Response | null {
  let origin: string
  try { origin = new URL(request.url).origin } catch { return jsonResponse({ error: 'リクエストURLが正しくありません。' }, 400) }
  if (request.headers.get('Origin') !== origin) return jsonResponse({ error: '許可されていない送信元です。' }, 403)
  if (request.headers.get('X-Dashboard-Action') !== action) return jsonResponse({ error: '更新用ヘッダーがありません。' }, 403)
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return jsonResponse({ error: 'JSON形式で送信してください。' }, 415)
  return null
}

async function readObject(request: Request): Promise<Record<string, unknown> | Response> {
  const raw = await request.text()
  if (raw.length > MAX_REQUEST_CHARS) return jsonResponse({ error: 'リクエストが大きすぎます。' }, 413)
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* handled below */ }
  return jsonResponse({ error: '入力内容の形式が正しくありません。' }, 400)
}

export async function readRecurringCreate(request: Request): Promise<Record<string, unknown> | Response> {
  const value = await readObject(request)
  if (value instanceof Response) return value
  if (!Number.isSafeInteger(value.template_rule_id) || Number(value.template_rule_id) <= 0) return jsonResponse({ error: 'テンプレートの定期登録が正しくありません。' }, 400)
  if (typeof value.start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.start_date)) return jsonResponse({ error: '開始日が正しくありません。' }, 400)
  if (value.frequency !== 'daily' && value.frequency !== 'weekly' && value.frequency !== 'monthly') return jsonResponse({ error: '頻度が正しくありません。' }, 400)
  if (!Number.isSafeInteger(value.interval_count) || Number(value.interval_count) < 1 || Number(value.interval_count) > 365) return jsonResponse({ error: '間隔は1〜365で指定してください。' }, 400)
  if (value.end_date !== null && (typeof value.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date))) return jsonResponse({ error: '終了日が正しくありません。' }, 400)
  if (typeof value.end_date === 'string' && value.end_date < value.start_date) return jsonResponse({ error: '終了日は開始日以降にしてください。' }, 400)
  if (value.type !== 'expense' && value.type !== 'income' && value.type !== 'offset') return jsonResponse({ error: '収支種別が正しくありません。' }, 400)
  if (!Number.isSafeInteger(value.amount) || Number(value.amount) < 1 || Number(value.amount) > 1_000_000_000) return jsonResponse({ error: '金額は1〜1,000,000,000円の整数で入力してください。' }, 400)
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200) return jsonResponse({ error: '内容は1〜200文字で入力してください。' }, 400)
  if (typeof value.category !== 'string' || !value.category.trim() || value.category.trim().length > 100) return jsonResponse({ error: 'カテゴリが正しくありません。' }, 400)
  if (value.payer !== null && (typeof value.payer !== 'string' || value.payer.trim().length > 100)) return jsonResponse({ error: '支払者は100文字以内で入力してください。' }, 400)
  if (value.memo !== null && (typeof value.memo !== 'string' || value.memo.trim().length > 2_000)) return jsonResponse({ error: 'メモは2,000文字以内で入力してください。' }, 400)
  return {
    p_template_rule_id: value.template_rule_id,
    p_start_date: value.start_date,
    p_frequency: value.frequency,
    p_interval_count: value.interval_count,
    p_end_date: value.end_date,
    p_amount: value.type === 'expense' ? value.amount : -Number(value.amount),
    p_title: value.title.trim(),
    p_category: value.category.trim(),
    p_payer: typeof value.payer === 'string' ? value.payer.trim() || null : null,
    p_memo: typeof value.memo === 'string' ? value.memo.trim() || null : null,
  }
}

export async function readRecurringUpdate(request: Request): Promise<{ id: number; active: boolean } | Response> {
  const value = await readObject(request)
  if (value instanceof Response) return value
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0 || typeof value.active !== 'boolean') return jsonResponse({ error: '更新内容が正しくありません。' }, 400)
  return { id: Number(value.id), active: value.active }
}

export async function readRecurringEdit(request: Request): Promise<Record<string, unknown> | Response> {
  const value = await readObject(request)
  if (value instanceof Response) return value
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) return jsonResponse({ error: '定期登録IDが正しくありません。' }, 400)
  if (value.frequency !== 'daily' && value.frequency !== 'weekly' && value.frequency !== 'monthly') return jsonResponse({ error: '頻度が正しくありません。' }, 400)
  if (!Number.isSafeInteger(value.interval_count) || Number(value.interval_count) < 1 || Number(value.interval_count) > 365) return jsonResponse({ error: '間隔は1〜365で指定してください。' }, 400)
  if (value.end_date !== null && (typeof value.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date))) return jsonResponse({ error: '終了日が正しくありません。' }, 400)
  if (value.type !== 'expense' && value.type !== 'income' && value.type !== 'offset') return jsonResponse({ error: '収支種別が正しくありません。' }, 400)
  if (!Number.isSafeInteger(value.amount) || Number(value.amount) < 1 || Number(value.amount) > 1_000_000_000) return jsonResponse({ error: '金額は1〜1,000,000,000円の整数で入力してください。' }, 400)
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200) return jsonResponse({ error: '内容は1〜200文字で入力してください。' }, 400)
  if (typeof value.category !== 'string' || !value.category.trim() || value.category.trim().length > 100) return jsonResponse({ error: 'カテゴリが正しくありません。' }, 400)
  if (value.payer !== null && (typeof value.payer !== 'string' || value.payer.trim().length > 100)) return jsonResponse({ error: '支払者は100文字以内で入力してください。' }, 400)
  if (value.memo !== null && (typeof value.memo !== 'string' || value.memo.trim().length > 2_000)) return jsonResponse({ error: 'メモは2,000文字以内で入力してください。' }, 400)
  return {
    p_id: value.id,
    p_frequency: value.frequency,
    p_interval_count: value.interval_count,
    p_end_date: value.end_date,
    p_amount: value.type === 'expense' ? value.amount : -Number(value.amount),
    p_title: value.title.trim(),
    p_category: value.category.trim(),
    p_payer: typeof value.payer === 'string' ? value.payer.trim() || null : null,
    p_memo: typeof value.memo === 'string' ? value.memo.trim() || null : null,
  }
}
