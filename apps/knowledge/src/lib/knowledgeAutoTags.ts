import type { Knowledge } from "../types";

/** 一覧APIは近い順に返すので、その順番で保持する。本文をまだ読んでいないカードも含む。 */
export function groupAutoTags(rows: { knowledge_id: string; tag: string }[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const row of rows) byId.set(row.knowledge_id, [...(byId.get(row.knowledge_id) ?? []), row.tag]);
  return byId;
}

/** 本文と別に取得したタグを、遅延取得・保存の応答にも同じように付ける。 */
export function withAutoTags(item: Knowledge, byId: ReadonlyMap<string, string[]>): Knowledge {
  return { ...item, auto_tags: byId.get(item.id) ?? [] };
}
