import { escapeHtml } from "../shared/html.js";
import { sf6Request } from "./api.js";
import { errorMessage } from "./format.js";
import { compassHistoryPath } from "../compass-routing.js";

export const INBOX_SF6_TYPES = { situations: "局面", sequences: "手順（コンボ / 起き攻め）", drills: "練習メニュー" };
const nameLimits = { situations: 60, sequences: 120, drills: 200 };
const isResource = (value) => Object.hasOwn(INBOX_SF6_TYPES, value);

/** A title is only a suggestion. The raw memo is never parsed as a move recipe. */
export function inboxSf6Preset(resource, content) {
  const firstLine = content.split(/\r\n?|\n/).find((line) => line.trim())?.trim() || "";
  const title = [...firstLine].slice(0, nameLimits[resource]).join("");
  if (resource === "situations") return { kind: "state", character: null, name: title, memo: content };
  if (resource === "sequences") return { kind: "combo", character: "", title, memo: content, notation: "" };
  return { title, detail: content };
}

export function parseSf6Entry(href) {
  const params = new URL(href).searchParams;
  const inboxId = Number(params.get("inbox"));
  const resource = params.get("resource");
  const id = Number(params.get("id"));
  if (params.has("inbox")) return Number.isSafeInteger(inboxId) && inboxId > 0
    ? { type: "inbox", inboxId, resource: isResource(params.get("create")) ? params.get("create") : "situations" }
    : { type: "invalid" };
  if (params.has("resource") || params.has("id")) return isResource(resource) && Number.isSafeInteger(id) && id > 0
    ? { type: "target", resource, id } : { type: "invalid" };
  return null;
}

export function createSf6InboxFlow({ state, els, openModal, closeModal, readDraft, load, selectTab, find, render, showToast }) {
  let handled = false;
  const drafts = new Map();
  const request = (url, init = {}) => sf6Request(url, { cache: "no-store", headers: { Accept: "application/json" }, ...init },
    (payload) => new Error(errorMessage(payload, "元Inboxを確認できませんでした。")));
  const readSource = (id) => request(`/api/inbox-sf6-source?id=${id}`);

  function showStatus(message, target = null, retry = null) {
    els.inboxStatus.hidden = false;
    els.inboxStatus.innerHTML = `<p>${escapeHtml(message)}</p>${target && !target.deleted ? `<a href="${escapeHtml(target.url)}">保存先を開く</a>` : ""}${retry ? '<button type="button" class="secondary-button" data-inbox-retry>表示を再読み込み</button>' : ""}`;
    els.inboxStatus.querySelector("[data-inbox-retry]")?.addEventListener("click", retry);
  }

  function openTarget(target) {
    if (target.deleted) { showStatus("SF6への保存は完了しています。保存先は削除済みです。"); return; }
    const item = find(target.resource, target.id);
    if (!item) { showStatus("指定されたSF6の記録が見つかりません。削除された可能性があります。"); return; }
    if (target.resource === "sequences") {
      state.sequenceCharacter = item.character;
      state.sequenceKind = item.kind;
      state.sequencePosition = "";
      state.conditions.situationId = null;
    } else if (target.resource === "situations") {
      state.situationCharacter = item.character || "";
      state.situationPosition = "";
    }
    selectTab(target.resource);
    render();
    openModal(target.resource, item);
  }

  async function finishSaved(target) {
    // Once a route succeeds the editor is gone. A failed GET cannot create a
    // second POST or replace the saved ID with a fresh idempotency key.
    closeModal();
    history.replaceState(null, "", target.url);
    const retry = async () => {
      if (await load()) { showStatus(target.deleted ? "SF6への保存は完了しています。保存先は削除済みです。" : "SF6へ保存しました。", target); openTarget(target); }
      else showStatus("SF6への保存は完了しています。表示を再読み込みしてください。", target, retry);
    };
    showStatus("SF6へ保存しました。登録先を読み込んでいます…", target);
    await retry();
  }

  function openSource(source, resource) {
    openModal(resource, null, drafts.get(resource) || inboxSf6Preset(resource, source.inbox.content), source);
  }

  function onOpened(editing) {
    els.inboxContext.hidden = true;
    els.inboxBoundary.hidden = true;
    const source = editing.inboxSource;
    if (source) {
      els.inboxContext.hidden = false;
      els.inboxContext.innerHTML = `<label>登録先<select data-inbox-resource>${Object.entries(INBOX_SF6_TYPES).map(([key, label]) => `<option value="${key}"${key === editing.resource ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
        ${editing.resource === "sequences" ? `<label>手順の種類<select data-inbox-kind><option value="combo"${editing.values.kind === "combo" ? " selected" : ""}>コンボ</option><option value="setplay"${editing.values.kind === "setplay" ? " selected" : ""}>起き攻め</option></select></label>` : ""}
        <details><summary>元Inboxのメモ</summary><p class="inbox-original"></p><a href="${escapeHtml(compassHistoryPath("inbox", source.inbox.id))}">元Inboxを開く</a></details>`;
      // textContent preserves leading/trailing newlines without HTML parsing.
      els.inboxContext.querySelector(".inbox-original").textContent = source.inbox.content;
      els.inboxContext.querySelector("[data-inbox-resource]").addEventListener("change", (event) => {
        drafts.set(editing.resource, readDraft());
        openSource(source, event.target.value);
      });
      els.inboxContext.querySelector("[data-inbox-kind]")?.addEventListener("change", (event) => {
        const draft = readDraft();
        drafts.set(`sequences:${editing.values.kind}`, draft);
        const kind = event.target.value;
        const next = drafts.get(`sequences:${kind}`) || { ...draft, kind, starts: [], results: [], aim: kind === "setplay" ? "strike" : null, layering: null, endPurpose: null };
        openModal("sequences", null, next, source);
      });
      els.inboxBoundary.hidden = false;
      els.inboxBoundary.textContent = "SF6へ保存し、元Inboxを整理済みにします。";
      els.saveButton.textContent = "SF6へ保存して整理済みにする";
      return;
    }
    if (!editing.item || !(editing.resource in INBOX_SF6_TYPES)) return;
    request(`/api/inbox-sf6-source?resource=${editing.resource}&targetId=${editing.item.id}`).then((result) => {
      if (state.editing !== editing || !result.inbox) return;
      els.inboxContext.hidden = false;
      els.inboxContext.innerHTML = result.inbox.status === "deleted"
        ? '<details><summary>元Inbox（削除済み）</summary><p class="inbox-original"></p></details>'
        : `<a href="${escapeHtml(compassHistoryPath("inbox", result.inbox.id))}">元Inboxを開く</a>`;
      const original = els.inboxContext.querySelector(".inbox-original");
      if (original) original.textContent = result.inbox.content;
    }).catch(() => {
      if (state.editing !== editing) return;
      els.inboxContext.hidden = false;
      els.inboxContext.textContent = "元Inboxの関連を確認できませんでした。";
    });
  }

  async function save(resource, fields, source) {
    const signature = JSON.stringify({ resource, fields });
    if (source.attempt && signature !== source.attempt) {
      const fresh = await readSource(source.inbox.id);
      if (fresh.sf6) { await finishSaved(fresh.sf6); return; }
      if (fresh.inbox?.status !== "pending") throw new Error("元Inboxは既に整理されています。最新の状態を確認してください。");
      source.inbox = fresh.inbox;
      source.key = crypto.randomUUID();
      const original = els.inboxContext.querySelector(".inbox-original");
      if (original) original.textContent = fresh.inbox.content;
    }
    source.attempt = signature;
    source.key ||= crypto.randomUUID();
    const result = await request("/api/inbox-route", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": "inbox-route" },
      body: JSON.stringify({ inboxId: source.inbox.id, exit: "sf6", idempotencyKey: source.key,
        params: { expected: { content: source.inbox.content, result: source.inbox.result ?? null }, resource, fields } }),
    });
    if (!result.sf6 || !isResource(result.sf6.resource) || !Number.isSafeInteger(result.sf6.id) || result.sf6.id <= 0) {
      throw new Error("保存結果を確認できませんでした。入力を変えずに再試行してください。");
    }
    await finishSaved({ ...result.sf6, url: `/sf6/?resource=${result.sf6.resource}&id=${result.sf6.id}` });
    showToast("SF6へ保存し、元Inboxを整理済みにしました");
  }

  async function onLoaded() {
    if (handled) return;
    const entry = parseSf6Entry(window.location.href);
    handled = true;
    if (!entry) return;
    if (entry.type === "target") { openTarget(entry); return; }
    if (entry.type === "invalid") { showStatus("SF6のリンクが正しくありません。"); return; }
    try {
      const source = await readSource(entry.inboxId);
      if (source.sf6) { openTarget(source.sf6); return; }
      if (source.inbox?.status !== "pending") { showStatus("元Inboxは既に別の行き先へ整理されています。"); return; }
      source.key = crypto.randomUUID();
      openSource(source, entry.resource);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "元Inboxを確認できませんでした。", null, () => { handled = false; return onLoaded(); });
    }
  }

  return { onOpened, save, onLoaded };
}
