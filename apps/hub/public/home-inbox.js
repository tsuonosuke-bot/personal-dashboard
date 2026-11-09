// ホームのInbox欄のうち、DOMに触れない部分。送信内容は Idea 画面と同じ /api/inbox の形にそろえる。
export const INBOX_PREVIEW = 3;
export const HOME_SKIP_RESULT = "ホームで見送り";

/** @type {typeof import("./home-inbox.d.ts").inboxSnapshot} */
export function inboxSnapshot(item) {
  return { content: item.content, status: item.status || "pending", result: item.result ?? null };
}

/** 未整理の1件を見送りにする。別の画面で変わっていれば、サーバーが編集前の値との不一致で拒否する。 */
/** @type {typeof import("./home-inbox.d.ts").skipRequest} */
export function skipRequest(item) {
  return { id: item.id, content: item.content, status: "skipped", result: HOME_SKIP_RESULT, original: inboxSnapshot(item) };
}

/** 見送りの取り消し。見送る前の内容へ戻す。 */
/** @type {typeof import("./home-inbox.d.ts").restoreRequest} */
export function restoreRequest(item) {
  const before = inboxSnapshot(item);
  return { id: item.id, ...before, original: { content: item.content, status: "skipped", result: HOME_SKIP_RESULT } };
}

/** 追加した1件を手元の一覧へ足す。一覧は古い順の先頭だけなので、空きがあるときだけ行を増やす。 */
/** @type {typeof import("./home-inbox.d.ts").withAdded} */
export function withAdded(state, row) {
  const item = { id: row.id, url: `/compass/?view=inbox&id=${row.id}`, content: row.content, status: "pending", result: row.result ?? null, createdAt: row.created_at ?? null, ageDays: 0 };
  return {
    pending: state.pending + 1,
    items: state.items.length < INBOX_PREVIEW ? [...state.items, item] : state.items,
  };
}

/** @type {typeof import("./home-inbox.d.ts").withRemoved} */
export function withRemoved(state, id) {
  return { pending: Math.max(0, state.pending - 1), items: state.items.filter((item) => item.id !== id) };
}

/** 見出しの件数。未整理のWantsがあれば並べて出す（アプリ一覧の「未整理」はこの2つの合計）。 */
/** @type {typeof import("./home-inbox.d.ts").inboxMetaLabel} */
export function inboxMetaLabel(pending, untriagedWants) {
  if (!Number.isFinite(pending)) return "Inboxを取得できません";
  const wants = Number.isFinite(untriagedWants) && Number(untriagedWants) > 0 ? ` · Wants ${untriagedWants}件` : "";
  return pending > 0 ? `未整理 ${pending}件${wants}` : `未整理のInboxなし${wants}`;
}
