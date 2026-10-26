// 未整理のInboxを続けて振り分ける流れ。振り分け・保留・クローズを保存したら、
// 一覧の並びで次の未整理を開き、残り件数を知らせる。最後の1件なら一覧へ戻る。
import { closeDrawer, openDrawer } from "./drawer.js";
import { showToast } from "./format.js";
import { currentItems } from "./list.js";
import { state } from "./state.js";
import { loadNextPendingInbox } from "./data.js";

function unsortedInbox() {
  return (state.data?.inbox || []).filter((item) => item.status === "pending");
}

export function unsortedInboxCount() {
  return state.data?.summary.pendingInbox ?? unsortedInbox().length;
}

/** 詳細を開いた時点の未整理の並び。保存後の再読込で一覧が変わっても、同じ順で次へ進むために控える。 */
export function rememberInboxOrder() {
  const visible = state.view === "inbox" ? currentItems().filter((item) => item.status === "pending").map((item) => item.id) : [];
  const rest = unsortedInbox().map((item) => item.id).filter((id) => !visible.includes(id));
  state.triageOrder = [...visible, ...rest];
}

/** 再読込の後に呼ぶ。次の未整理があれば開き、無ければ詳細を閉じる。 */
export async function continueInboxTriage(item, message) {
  const pending = new Set(unsortedInbox().map((entry) => entry.id));
  pending.delete(item.id);
  const order = state.triageOrder || [];
  const index = order.indexOf(item.id);
  const after = index < 0 ? order : [...order.slice(index + 1), ...order.slice(0, index)];
  let nextId = after.find((id) => pending.has(id)) ?? [...pending][0];
  if (nextId === undefined && unsortedInboxCount() > 0) {
    try { nextId = (await loadNextPendingInbox())?.id; }
    catch { closeDrawer(); showToast(`${message} 次のInboxを取得できませんでした。再読み込みしてください。`); return; }
  }
  if (nextId === undefined) {
    closeDrawer();
    showToast(`${message} 未整理のInboxはもうありません。`);
    return;
  }
  openDrawer(nextId, "inbox", "push");
  showToast(`${message} 次へ進みます（残り${unsortedInboxCount()}件）。`);
}
