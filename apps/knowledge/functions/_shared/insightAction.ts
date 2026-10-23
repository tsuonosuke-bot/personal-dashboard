import { isUuid } from "./knowledgeValidation.ts";
import { jsonResponse, requestSupabaseRows, type SupabaseEnv } from "./supabaseRest.ts";

export interface ActionReference { sourceType: "insight" | "journal"; sourceId: string }
export interface ActionSource extends ActionReference { title: string; body: string; knowledgeId: string | null }
type SourceResult = { ok: true; value: ActionSource } | { ok: false; response: Response };

export function readActionReference(type: unknown, id: unknown): ActionReference | null {
  if (typeof id !== "string") return null;
  if (type === "insight" && /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id))) {
    return { sourceType: type, sourceId: id };
  }
  if (type === "journal" && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
    const date = new Date(`${id}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === id) return { sourceType: type, sourceId: id };
  }
  return null;
}

export async function readActionInput(request: Request): Promise<{ ok: true; value: ActionReference & { note: string } } | { ok: false; response: Response }> {
  let raw: string;
  try { raw = await request.text(); } catch { return { ok: false, response: jsonResponse({ error: "入力内容を読み取れませんでした。" }, 400) }; }
  if (raw.length > 4_000) return { ok: false, response: jsonResponse({ error: "リクエストが大きすぎます。" }, 413) };
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { return { ok: false, response: jsonResponse({ error: "JSONの形式が正しくありません。" }, 400) }; }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "note,sourceId,sourceType") {
    return { ok: false, response: jsonResponse({ error: "入力内容の形式が正しくありません。" }, 400) };
  }
  const fields = body as Record<string, unknown>;
  const source = readActionReference(fields.sourceType, fields.sourceId);
  if (!source || typeof fields.note !== "string" || !fields.note.trim() || fields.note.trim().length > 500) {
    return { ok: false, response: jsonResponse({ error: "元の示唆・日記を指定し、行動を1〜500文字で入力してください。" }, 400) };
  }
  return { ok: true, value: { ...source, note: fields.note.trim() } };
}

/** 出典はIDから引き直す。ブラウザーが送った本文やタイトルを出典として保存しない。 */
export async function loadActionSource(env: SupabaseEnv, ref: ActionReference): Promise<SourceResult> {
  const journal = ref.sourceType === "journal";
  const result = await requestSupabaseRows(env, {
    table: journal ? "daily_journal" : "knowledge_insights",
    params: new URLSearchParams({ select: journal ? "entry_date,summary" : "id,knowledge_id,body", [journal ? "entry_date" : "id"]: `eq.${ref.sourceId}`, limit: "1" }),
  });
  if (!result.ok) return result;
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, response: jsonResponse({ error: "元の示唆・日記が見つかりません。削除されている可能性があります。" }, 404) };
  const body = journal ? row.summary : row.body;
  if (typeof body !== "string" || (!journal && (typeof row.knowledge_id !== "string" || !isUuid(row.knowledge_id)))) {
    return { ok: false, response: jsonResponse({ error: "出典の内容を確認できませんでした。" }, 502) };
  }
  if (journal) return { ok: true, value: { ...ref, title: `${ref.sourceId}の日記`, body, knowledgeId: null } };
  const knowledgeId = row.knowledge_id as string;
  const knowledge = await requestSupabaseRows(env, {
    table: "knowledge", params: new URLSearchParams({ select: "id,title", id: `eq.${knowledgeId}`, limit: "1" }),
  });
  if (!knowledge.ok) return knowledge;
  const title = (knowledge.rows[0] as { title?: unknown } | undefined)?.title;
  if (typeof title !== "string") return { ok: false, response: jsonResponse({ error: "出典のナレッジが見つかりません。" }, 404) };
  return { ok: true, value: { ...ref, title, body, knowledgeId } };
}

function clipText(value: string, length: number): string {
  const last = value.charCodeAt(length - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? length - 1 : length);
}

export function actionInboxContent(note: string, source: ActionSource): string {
  // Ideaの入力上限（2,000文字）以内に収め、1行目を利用者の行動にする。
  const excerpt = source.body.length > 1_000 ? `${clipText(source.body, 999)}…` : source.body;
  const title = clipText(source.title.replace(/[\r\n]+/g, " "), 160);
  const label = source.sourceType === "insight" ? "示唆" : "日記";
  return `${note}\n\n元の${label}: ${excerpt}\n\n行動元: ${title}（${source.sourceType} ${source.sourceId}）`;
}
