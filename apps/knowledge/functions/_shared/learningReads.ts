import { jsonResponse } from "./supabaseRest.ts";

export function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const isUuid = (value: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
export function learningFilters(request: Request) {
  const query = new URL(request.url).searchParams;
  const from = query.get("from");
  const category = query.get("category");
  const verdict = query.get("verdict");
  const unconfirmed = query.get("unconfirmed");
  const knowledgeId = query.get("knowledge_id");
  const misses = query.get("misses");
  const ids = query.get("result_ids")?.split(",") ?? null;
  if (from !== null && !isDate(from) || category !== null && (category.length > 300 || !category.trim())
    || verdict !== null && !["正解", "不正解", "部分正解"].includes(verdict)
    || unconfirmed !== null && !["true", "false"].includes(unconfirmed)
    || knowledgeId !== null && !isUuid(knowledgeId)
    || misses !== null && !["true", "false"].includes(misses)
    || ids !== null && (ids.length > 200 || ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))))) {
    return { ok: false as const, response: jsonResponse({ error: "履歴の検索条件が正しくありません。" }, 400) };
  }
  return { ok: true as const, value: { p_from: from, p_category: category, p_verdict: verdict,
    p_unconfirmed: unconfirmed === "true", p_knowledge_id: knowledgeId, p_misses: misses === "true", p_ids: ids?.map(Number) ?? null } };
}
