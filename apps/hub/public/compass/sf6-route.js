// Inbox only: the real editor lives in SF6. No memo text goes into a URL or localStorage.
import { readApiJson } from "../api-client.js";
import { escapeHtml, setDrawerTitle, sourceTextMarkup } from "./format.js";
import { els, state } from "./state.js";
import { renderDrawerItem } from "./drawer.js";

const types = { situations: "局面", sequences: "手順（コンボ / 起き攻め）", drills: "練習メニュー" };

export function renderSf6Route(item) {
  if (item.status !== "pending" || state.triageSource !== "inbox") return;
  setDrawerTitle("SF6の登録先を選ぶ");
  els.drawerBody.innerHTML = `<div class="source-context"><span>元のInbox</span>${sourceTextMarkup(item.content)}</div>
    <div class="triage-options">${Object.entries(types).map(([resource, label]) => `<a class="triage-option" href="/sf6/?inbox=${item.id}&create=${resource}"><strong>${escapeHtml(label)}</strong><span>SF6で必要な項目を確認して保存</span></a>`).join("")}</div>
    <div class="drawer-actions"><button class="secondary-action" type="button" data-sf6-back>戻る</button></div>`;
  els.drawerBody.querySelector("[data-sf6-back]").addEventListener("click", () => renderDrawerItem(item, "inbox"));
}

export async function loadSf6InboxRelation(item, element) {
  try {
    const response = await fetch(`/api/inbox-sf6-source?id=${item.id}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!element.isConnected || !response.ok || !payload.sf6) return;
    const target = payload.sf6;
    if (!Object.hasOwn(types, target.resource) || !Number.isSafeInteger(target.id) || target.id <= 0) return;
    element.innerHTML = target.deleted ? '<p>SF6への保存先は削除済みです。</p>'
      : `<a href="/sf6/?resource=${target.resource}&id=${target.id}">SF6の${escapeHtml(types[target.resource])}を開く</a>`;
  } catch {
    if (element.isConnected) element.textContent = "SF6の関連を確認できませんでした。再読み込みしてください。";
  }
}
