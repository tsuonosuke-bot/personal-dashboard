// 編集フォーム（Inbox・Item・Wish・保留）とクローズ。
import { readApiJson } from "../api-client.js";
import { closeMeta, itemEditMeta } from "./constants.js";
import { loadDashboard } from "./data.js";
import { closeDrawer, renderDrawerItem } from "./drawer.js";
import { defaultRevisitDate, escapeHtml, setDrawerTitle, showToast, sourceTextMarkup, todayInTokyo } from "./format.js";
import { canCloseItem, statusLabel } from "./list.js";
import { triageKicker } from "./route.js";
import { els } from "./state.js";
import { continueInboxTriage } from "./triage-flow.js";

function setCloseItemError(message) {
  const error = document.getElementById("closeItemError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

export async function closeItem(item, view) {
  const meta = closeMeta[view];
  const button = document.getElementById("closeItemButton");
  if (!meta || !button || !canCloseItem(item, view)) return;
  if (!window.confirm(meta.confirm)) return;

  button.disabled = true;
  button.textContent = "クローズ中…";
  setCloseItemError("");

  try {
    if (view === "inbox") {
      await routeInboxViaApi(item.id, "close", { expected: inboxExpected(item) }, crypto.randomUUID());
    } else {
      const response = await fetch(meta.endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": meta.actionHeader,
        },
        body: JSON.stringify({
          id: item.id,
          content: item.content,
          status: meta.closedStatus,
          original: { content: item.content, status: item.status },
        }),
      });
      const payload = await readApiJson(response);
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      if (!response.ok) throw new Error(message || `${meta.button}に失敗しました。`);
    }

    if (view === "inbox") {
      // Inboxは続けて片付けられるよう、閉じずに次の未整理へ進む。
      const refreshed = await loadDashboard();
      if (refreshed) continueInboxTriage(item, meta.success);
      else {
        closeDrawer();
        showToast(`${meta.success} 最新状態は再読込して確認してください。`);
      }
      return;
    }
    closeDrawer();
    const refreshed = await loadDashboard();
    showToast(refreshed ? meta.success : `${meta.success} 最新状態は再読込して確認してください。`);
  } catch (error) {
    setCloseItemError(error instanceof Error ? error.message : `${meta.button}に失敗しました。`);
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = meta.button;
    }
  }
}

export function renderInboxEditForm(item) {
  const statuses = ["pending", "done", "skipped"];
  const currentOption = statuses.includes(item.status)
    ? ""
    : `<option value="${escapeHtml(item.status)}" selected disabled>${escapeHtml(statusLabel(item.status))}</option>`;
  const statusOptions = statuses.map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("");
  setDrawerTitle("Inboxを編集");
  els.drawerBody.innerHTML = `<form class="edit-form" id="inboxEditForm">
    <label class="form-field" for="editInboxContent">
      <span>内容</span>
      <textarea id="editInboxContent" name="content" rows="7" maxlength="2000" required>${escapeHtml(item.content)}</textarea>
      <small><b id="editContentCount">${item.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="editInboxStatus">
      <span>ステータス</span>
      <select id="editInboxStatus" name="status">${currentOption}${statusOptions}</select>
    </label>
    <label class="form-field" for="editInboxResult">
      <span>整理結果 <small>空欄可</small></span>
      <textarea id="editInboxResult" name="result" rows="5" maxlength="2000">${escapeHtml(item.result || "")}</textarea>
      <small><b id="editResultCount">${(item.result || "").length}</b> / 2000</small>
    </label>
    <p class="form-error" id="inboxEditError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelInboxEdit" type="button">キャンセル</button>
      <button class="primary-action" id="saveInboxEdit" type="submit">変更を保存</button>
    </div>
  </form>`;

  const form = document.getElementById("inboxEditForm");
  const content = document.getElementById("editInboxContent");
  const result = document.getElementById("editInboxResult");
  content.addEventListener("input", () => { document.getElementById("editContentCount").textContent = content.value.length; });
  result.addEventListener("input", () => { document.getElementById("editResultCount").textContent = result.value.length; });
  document.getElementById("cancelInboxEdit").addEventListener("click", () => renderDrawerItem(item, "inbox"));
  form.addEventListener("submit", (event) => saveInbox(event, item));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setInboxEditError(message) {
  const error = document.getElementById("inboxEditError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveInbox(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  if (!content) {
    setInboxEditError("Inboxの内容を入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveInboxEdit");
  const cancel = document.getElementById("cancelInboxEdit");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setInboxEditError("");

  try {
    const response = await fetch("/api/inbox", {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": "inbox-update",
      },
      body: JSON.stringify({
        id: item.id,
        content,
        status: form.elements.status.value,
        result: form.elements.result.value,
        original: { content: item.content, status: item.status, result: item.result },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || "Inboxを更新できませんでした。");

    const refreshed = await loadDashboard();
    if (!refreshed) {
      setInboxEditError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast("Inboxを更新しました。");
  } catch (error) {
    setInboxEditError(error instanceof Error ? error.message : "Inboxを更新できませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "変更を保存";
    }
  }
}

export function renderItemEditForm(item, view) {
  const meta = itemEditMeta[view];
  if (!meta) return;
  const currentOption = meta.statuses.includes(item.status)
    ? ""
    : `<option value="${escapeHtml(item.status)}" selected disabled>${escapeHtml(statusLabel(item.status))}</option>`;
  const statusOptions = meta.statuses.map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("");
  setDrawerTitle(meta.title);
  els.drawerBody.innerHTML = `<form class="edit-form" id="itemEditForm">
    <label class="form-field" for="editItemContent">
      <span>内容</span>
      <textarea id="editItemContent" name="content" rows="7" maxlength="2000" required>${escapeHtml(item.content)}</textarea>
      <small><b id="editItemContentCount">${item.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="editItemStatus">
      <span>ステータス</span>
      <select id="editItemStatus" name="status">${currentOption}${statusOptions}</select>
    </label>
    <p class="form-error" id="itemEditError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelItemEdit" type="button">キャンセル</button>
      <button class="primary-action" id="saveItemEdit" type="submit">変更を保存</button>
    </div>
  </form>`;

  const form = document.getElementById("itemEditForm");
  const content = document.getElementById("editItemContent");
  content.addEventListener("input", () => { document.getElementById("editItemContentCount").textContent = content.value.length; });
  document.getElementById("cancelItemEdit").addEventListener("click", () => renderDrawerItem(item, view));
  form.addEventListener("submit", (event) => saveItem(event, item, view));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setItemEditError(message) {
  const error = document.getElementById("itemEditError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveItem(event, item, view) {
  event.preventDefault();
  const form = event.currentTarget;
  const meta = itemEditMeta[view];
  const content = form.elements.content.value.trim();
  if (!content) {
    setItemEditError("内容を入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveItemEdit");
  const cancel = document.getElementById("cancelItemEdit");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setItemEditError("");

  try {
    const response = await fetch(meta.endpoint, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Dashboard-Action": meta.actionHeader,
      },
      body: JSON.stringify({
        id: item.id,
        content,
        status: form.elements.status.value,
        original: { content: item.content, status: item.status },
      }),
    });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(message || `${meta.title}を保存できませんでした。`);

    const refreshed = await loadDashboard();
    if (!refreshed) {
      setItemEditError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    showToast(meta.success);
  } catch (error) {
    setItemEditError(error instanceof Error ? error.message : `${meta.title}を保存できませんでした。`);
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "変更を保存";
    }
  }
}

export function inboxExpected(item) {
  return { content: item.content, result: item.result ?? null };
}

// Inboxの振り分けはすべて inbox-route-v1 のDB関数で1トランザクションに確定する。
export async function routeInboxViaApi(inboxId, exit, params, idempotencyKey) {
  const response = await fetch("/api/inbox-route", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "inbox-route",
    },
    body: JSON.stringify({ inboxId, exit, params, idempotencyKey }),
  });
  const payload = await readApiJson(response);
  const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok) throw new Error(message || "振り分けを保存できませんでした。");
  return payload;
}

export function renderWishForm(sourceItem) {
  els.drawerKicker.textContent = triageKicker(sourceItem, "inbox");
  setDrawerTitle("欲しいもの");
  els.drawerBody.innerHTML = `<form class="edit-form" id="wishForm">
    <div class="source-context"><span>元のInbox</span>${sourceTextMarkup(sourceItem.content)}</div>
    <p class="route-boundary">購入予定にはせず、欲しいものとしてWantsに残します。必要になったら予定・調査・見送りへ振り分けられます。</p>
    <label class="form-field" for="wishContent">
      <span>欲しいもの</span>
      <textarea id="wishContent" name="content" rows="6" maxlength="2000" required>${escapeHtml(sourceItem.content)}</textarea>
      <small><b id="wishContentCount">${sourceItem.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="wishNote">
      <span>メモ <small>空欄可</small></span>
      <textarea id="wishNote" name="note" rows="4" maxlength="2000" placeholder="欲しい理由、条件、候補など"></textarea>
    </label>
    <p class="form-error" id="wishError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelWish" type="button">戻る</button>
      <button class="primary-action" id="saveWishButton" type="submit">欲しいものとして保存</button>
    </div>
  </form>`;

  const form = document.getElementById("wishForm");
  const content = document.getElementById("wishContent");
  content.addEventListener("input", () => { document.getElementById("wishContentCount").textContent = content.value.length; });
  document.getElementById("cancelWish").addEventListener("click", () => renderDrawerItem(sourceItem, "inbox"));
  const idempotencyKey = crypto.randomUUID();
  form.addEventListener("submit", (event) => saveWish(event, sourceItem, idempotencyKey));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setWishError(message) {
  const error = document.getElementById("wishError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveWish(event, sourceItem, idempotencyKey) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  const note = form.elements.note.value.trim();
  if (!content) {
    setWishError("欲しいものを入力してください。");
    form.elements.content.focus();
    return;
  }

  const submit = document.getElementById("saveWishButton");
  const cancel = document.getElementById("cancelWish");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setWishError("");

  try {
    await routeInboxViaApi(sourceItem.id, "wish", {
      expected: inboxExpected(sourceItem),
      content,
      note: note || null,
    }, idempotencyKey);
    const refreshed = await loadDashboard();
    if (!refreshed) {
      setWishError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    continueInboxTriage(sourceItem, "欲しいものとしてWantsに保存し、Inboxを整理済みにしました。");
  } catch (error) {
    setWishError(error instanceof Error ? error.message : "欲しいものとして保存できませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "欲しいものとして保存";
    }
  }
}

export function renderDeferForm(sourceItem) {
  const revisitOn = defaultRevisitDate();
  els.drawerKicker.textContent = triageKicker(sourceItem, "inbox");
  setDrawerTitle("保留");
  els.drawerBody.innerHTML = `<form class="edit-form" id="deferForm">
    <div class="source-context"><span>元のInbox</span>${sourceTextMarkup(sourceItem.content)}</div>
    <p class="route-boundary">振り分け先は決めず、次に考える日だけ決めてWantsへ置きます。再訪日が来ると未整理のWantsとして浮上します。</p>
    <label class="form-field" for="deferContent">
      <span>内容</span>
      <textarea id="deferContent" name="content" rows="6" maxlength="2000" required>${escapeHtml(sourceItem.content)}</textarea>
      <small><b id="deferContentCount">${sourceItem.content.length}</b> / 2000</small>
    </label>
    <label class="form-field" for="deferRevisitOn">
      <span>再訪日</span>
      <input id="deferRevisitOn" name="revisitOn" type="date" value="${escapeHtml(revisitOn)}" min="${escapeHtml(todayInTokyo())}" required>
      <small>既定は1ヶ月後です。</small>
    </label>
    <label class="form-field" for="deferNote">
      <span>メモ <small>空欄可</small></span>
      <textarea id="deferNote" name="note" rows="4" maxlength="2000" placeholder="今は動かさない理由、再訪時に思い出したいこと"></textarea>
    </label>
    <p class="form-error" id="deferError" role="alert" hidden></p>
    <div class="drawer-actions">
      <button class="secondary-action" id="cancelDefer" type="button">戻る</button>
      <button class="primary-action" id="saveDeferButton" type="submit">保留にする</button>
    </div>
  </form>`;

  const form = document.getElementById("deferForm");
  const content = document.getElementById("deferContent");
  content.addEventListener("input", () => { document.getElementById("deferContentCount").textContent = content.value.length; });
  document.getElementById("cancelDefer").addEventListener("click", () => renderDrawerItem(sourceItem, "inbox"));
  const idempotencyKey = crypto.randomUUID();
  form.addEventListener("submit", (event) => saveDefer(event, sourceItem, idempotencyKey));
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
}

function setDeferError(message) {
  const error = document.getElementById("deferError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveDefer(event, sourceItem, idempotencyKey) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  const revisitOn = form.elements.revisitOn.value;
  const note = form.elements.note.value.trim();
  if (!content) {
    setDeferError("内容を入力してください。");
    form.elements.content.focus();
    return;
  }
  if (!revisitOn) {
    setDeferError("再訪日を入力してください。");
    form.elements.revisitOn.focus();
    return;
  }
  if (revisitOn < todayInTokyo()) {
    setDeferError("再訪日は今日以降の日付を指定してください。");
    form.elements.revisitOn.focus();
    return;
  }

  const submit = document.getElementById("saveDeferButton");
  const cancel = document.getElementById("cancelDefer");
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "保存中…";
  setDeferError("");

  try {
    await routeInboxViaApi(sourceItem.id, "defer", {
      expected: inboxExpected(sourceItem),
      content,
      revisit_on: revisitOn,
      note: note || null,
    }, idempotencyKey);
    const refreshed = await loadDashboard();
    if (!refreshed) {
      setDeferError("保存は完了しましたが、最新状態を再読み込みできませんでした。再読込してください。");
      return;
    }
    continueInboxTriage(sourceItem, `${revisitOn}に再訪するWantとして保留し、Inboxを整理済みにしました。`);
  } catch (error) {
    setDeferError(error instanceof Error ? error.message : "保留にできませんでした。");
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "保留にする";
    }
  }
}
