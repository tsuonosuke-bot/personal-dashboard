import { parsePageEnvelope } from './apiValidation.ts'

const PAGE_SIZE = 1_000
const MAX_REQUESTS = 10_000

/** Legacy/export reads retain complete history; exact count is requested only once. */
export async function readAllPages<T>(path: string, parseItem: (value: unknown) => T,
  request: (path: string) => Promise<unknown>): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?'
  const readPage = async (offset: number) => {
    const page = parsePageEnvelope(await request(`${path}${separator}limit=${PAGE_SIZE}&offset=${offset}&count=${offset === 0 ? 'exact' : 'none'}`))
    if (page.offset !== offset || page.limit !== PAGE_SIZE || page.items.length > PAGE_SIZE) throw new Error('APIのページ情報が要求内容と一致しません。')
    return page
  }
  const first = await readPage(0)
  const result = first.items.map(parseItem)
  if (!result.length) return result
  if (first.total !== null && first.items.length === PAGE_SIZE) {
    const offsets: number[] = []
    for (let offset = PAGE_SIZE; offset < first.total; offset += PAGE_SIZE) offsets.push(offset)
    if (offsets.length + 1 > MAX_REQUESTS) throw new Error('データ件数が安全な取得上限を超えています。')
    // A small wave also avoids opening thousands of requests for a large legacy export.
    let last = first
    for (let start = 0; start < offsets.length; start += 4) {
      const pages = await Promise.all(offsets.slice(start, start + 4).map(readPage))
      for (const page of pages) { result.push(...page.items.map(parseItem)); last = page }
    }
    if (last.items.length < PAGE_SIZE || (offsets.length === 0 && first.total <= PAGE_SIZE)) return result
  } else if (first.total !== null && first.items.length >= first.total) return result
  let offset = result.length
  for (let requests = Math.ceil(offset / PAGE_SIZE); requests < MAX_REQUESTS; requests += 1) {
    const page = await readPage(offset)
    result.push(...page.items.map(parseItem))
    if (!page.items.length || (page.total !== null && result.length >= page.total)) return result
    offset += page.items.length
  }
  throw new Error('データ件数が安全な取得上限を超えています。')
}
