export const GROUP_ACTION_HEADER = "knowledge-insight-group";
export const GROUP_SELECT = "id,title,guiding_question,created_at,updated_at";
export const MEMBER_SELECT = "group_id,insight_id";

const MAX_REQUEST_CHARS = 4_000;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function validateGroupRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== GROUP_ACTION_HEADER) {
    return { status: 403, error: "示唆グループの更新用ヘッダーがありません。" };
  }
  if (!(request.headers.get("Content-Type")?.toLowerCase() ?? "").startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

async function readObject(request: Request, keys: string[]): Promise<Result<Record<string, unknown>>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "リクエストを読み取れませんでした。" };
  }
  if (text.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  return { ok: true, value: record };
}

function readText(value: unknown, max: number, label: string): Result<string> {
  if (typeof value !== "string") return { ok: false, status: 400, error: `${label}を入力してください。` };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    return { ok: false, status: 400, error: `${label}は1〜${max}文字で入力してください。` };
  }
  return { ok: true, value: trimmed };
}

function readTimestamp(value: unknown): Result<string> {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    return { ok: false, status: 400, error: "更新前の示唆グループの情報が正しくありません。" };
  }
  return { ok: true, value };
}

export function readPositiveId(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function readGroupId(raw: string | string[] | undefined): number | null {
  return readPositiveId(Array.isArray(raw) ? raw[0] : raw);
}

/** 問いの短い名前。空なら問い文から作る（末尾の「？」を外し、長ければ40文字で切る）。 */
export function deriveQuestionTitle(question: string): string {
  const base = question.replace(/\s+/g, " ").trim().replace(/[？?]+$/, "").trim() || question.trim();
  return base.length > 40 ? `${base.slice(0, 39)}…` : base;
}

function readTitle(value: unknown, question: string): Result<string> {
  if (value === "" || (typeof value === "string" && !value.trim())) return { ok: true, value: deriveQuestionTitle(question) };
  return readText(value, 120, "問いの名前");
}

export async function readGroupCreate(request: Request): Promise<Result<{ title: string; guidingQuestion: string }>> {
  const parsed = await readObject(request, ["title", "guiding_question"]);
  if (!parsed.ok) return parsed;
  const question = readText(parsed.value.guiding_question, 300, "問い文");
  if (!question.ok) return question;
  const title = readTitle(parsed.value.title, question.value);
  if (!title.ok) return title;
  return { ok: true, value: { title: title.value, guidingQuestion: question.value } };
}

export async function readGroupUpdate(request: Request): Promise<Result<{ title: string; guidingQuestion: string; expectedUpdatedAt: string }>> {
  const parsed = await readObject(request, ["title", "guiding_question", "expected_updated_at"]);
  if (!parsed.ok) return parsed;
  const question = readText(parsed.value.guiding_question, 300, "問い文");
  if (!question.ok) return question;
  const title = readTitle(parsed.value.title, question.value);
  if (!title.ok) return title;
  const timestamp = readTimestamp(parsed.value.expected_updated_at);
  if (!timestamp.ok) return timestamp;
  return { ok: true, value: { title: title.value, guidingQuestion: question.value, expectedUpdatedAt: timestamp.value } };
}

export async function readGroupDelete(request: Request): Promise<Result<{ expectedUpdatedAt: string }>> {
  const parsed = await readObject(request, ["expected_updated_at"]);
  if (!parsed.ok) return parsed;
  const timestamp = readTimestamp(parsed.value.expected_updated_at);
  if (!timestamp.ok) return timestamp;
  return { ok: true, value: { expectedUpdatedAt: timestamp.value } };
}

export async function readMemberChange(request: Request): Promise<Result<{ groupId: number; insightId: number }>> {
  const parsed = await readObject(request, ["group_id", "insight_id"]);
  if (!parsed.ok) return parsed;
  const groupId = readPositiveId(parsed.value.group_id);
  const insightId = readPositiveId(parsed.value.insight_id);
  if (!groupId || !insightId) return { ok: false, status: 400, error: "グループまたは示唆のIDが正しくありません。" };
  return { ok: true, value: { groupId, insightId } };
}
