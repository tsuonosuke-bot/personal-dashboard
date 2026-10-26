/** Validate routing requests before any target creation or source update. */
import { MAX_REQUEST_CHARS, type ValidationResult, isPlainObject, intentSet, destinationSet, type RouteIntent, type RouteDestination, allowedDestinationsByIntent, MAX_TITLE_CHARS, MAX_DETAIL_CHARS, cadenceSet, type HabitCadence, isUuid, hasOnlyKeys } from "./wantRouteModel.ts";
import { parseCalendarSchedule } from "./googleCalendar.ts";

export function validateWantRouteRequest(request: Request): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "want-route-create") {
    return { status: 403, error: "振り分け用ヘッダーがありません。" };
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) return { status: 415, error: "JSON形式で送信してください。" };
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

export async function readWantRouteInput(request: Request): Promise<ValidationResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  const keys = ["wantId", "intent", "destination", "title", "detail", "cadence", "calendar", "idempotencyKey", "original"];
  const requiredKeys = ["wantId", "intent", "destination", "title", "detail", "cadence", "idempotencyKey", "original"];
  if (!isPlainObject(value) || !Object.keys(value).every((key) => keys.includes(key)) || !requiredKeys.every((key) => key in value)) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  if (!Number.isSafeInteger(value.wantId) || Number(value.wantId) <= 0) {
    return { ok: false, status: 400, error: "Want IDが正しくありません。" };
  }
  if (typeof value.intent !== "string" || !intentSet.has(value.intent)) {
    return { ok: false, status: 400, error: "整理方法が正しくありません。" };
  }
  if (typeof value.destination !== "string" || !destinationSet.has(value.destination)) {
    return { ok: false, status: 400, error: "振り分け先が正しくありません。" };
  }
  const intent = value.intent as RouteIntent;
  const destination = value.destination as RouteDestination;
  if (!allowedDestinationsByIntent[intent].has(destination)) {
    return { ok: false, status: 400, error: "整理方法と振り分け先の組み合わせが正しくありません。" };
  }
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return { ok: false, status: 400, error: "タイトルを入力してください。" };
  }
  const title = value.title.trim();
  if (title.length > MAX_TITLE_CHARS) {
    return { ok: false, status: 400, error: `タイトルは${MAX_TITLE_CHARS}文字以内で入力してください。` };
  }
  if (value.detail !== null && typeof value.detail !== "string") {
    return { ok: false, status: 400, error: "補足内容が正しくありません。" };
  }
  const detail = typeof value.detail === "string" && value.detail.trim().length > 0 ? value.detail.trim() : null;
  if ((detail?.length || 0) > MAX_DETAIL_CHARS) {
    return { ok: false, status: 400, error: `補足内容は${MAX_DETAIL_CHARS}文字以内で入力してください。` };
  }
  if (value.cadence !== null && (typeof value.cadence !== "string" || !cadenceSet.has(value.cadence))) {
    return { ok: false, status: 400, error: "習慣の頻度が正しくありません。" };
  }
  const cadence = value.cadence as HabitCadence | null;
  if (destination === "habit" && !cadence) return { ok: false, status: 400, error: "習慣の頻度を選択してください。" };
  if (destination !== "habit" && cadence !== null) {
    return { ok: false, status: 400, error: "この振り分け先には習慣の頻度を設定できません。" };
  }
  const calendar = parseCalendarSchedule(value.calendar);
  if (destination === "calendar" && !calendar) {
    return { ok: false, status: 400, error: "Google Calendarへ登録する日付と時間を確認してください。" };
  }
  if (destination !== "calendar" && value.calendar !== undefined && value.calendar !== null) {
    return { ok: false, status: 400, error: "この振り分け先にはCalendar予定を設定できません。" };
  }
  if (typeof value.idempotencyKey !== "string" || !isUuid(value.idempotencyKey)) {
    return { ok: false, status: 400, error: "処理IDが正しくありません。" };
  }
  if (!isPlainObject(value.original) || !hasOnlyKeys(value.original, ["content", "status"]) ||
      typeof value.original.content !== "string" || value.original.content.length > 2_000 || value.original.status !== "active") {
    return { ok: false, status: 400, error: "整理前のWant情報が正しくありません。" };
  }

  return {
    ok: true,
    value: {
      wantId: Number(value.wantId),
      intent,
      destination,
      title,
      detail,
      cadence,
      calendar,
      idempotencyKey: value.idempotencyKey,
      original: { content: value.original.content, status: "active" },
    },
  };
}
