// コンボ追加フォームの「AIで入力」。文章またはメモの写真から下書きを作り、フォームに流し込む（保存はしない）。
// 画像は長辺1600pxのJPEGに縮めてから送る。通信は /api/sf6/ai-draft、AIの呼び出しはサーバー側。
import { escapeHtml } from "../shared/html.js";
import { parseNotation } from "../sf6-notation.js";
import { sf6Request } from "./api.js";
import { errorMessage } from "./format.js";

const MAX_SIDE = 1600;

export function aiDraftFieldHtml() {
  return `<details class="ai-draft" data-field="aiDraft">
    <summary>AIで入力（文章・メモの写真）</summary>
    <small class="field-hint">先にキャラを入れてから。作られるのは下書きだけで、確認して直してから保存します</small>
    <textarea id="aiDraftText" rows="3" maxlength="2000" placeholder="例：中Kから強P、昇龍でキャンセル"></textarea>
    <label class="ai-draft-file"><span>メモの写真（任意）</span><input type="file" id="aiDraftImage" accept="image/*" /></label>
    <button type="button" class="ghost-button" data-ai-draft="run">下書きを作る</button>
    <div id="aiDraftResult" class="ai-draft-result" aria-live="polite"></div>
  </details>`;
}

/** @param {File} file */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

export function createSf6AiDraft({ state, els, refreshNotationAssist }) {
  /** @type {Array<{title: string, notation: string, startup: number | null, driveCost: number, saCost: number, note: string}>} */
  let drafts = [];
  let running = false;

  const result = () => document.getElementById("aiDraftResult");

  function draftHtml(draft, index) {
    const unreadable = parseNotation(draft.notation).filter((part) => part.type === "text").map((part) => part.text);
    return `<article class="ai-draft-card">
      <b>${escapeHtml(draft.title || "（名前なし）")}</b>
      <code>${escapeHtml(draft.notation)}</code>
      <small>発生${draft.startup ?? "–"}F ・ Dゲージ${draft.driveCost} ・ SA${draft.saCost || "なし"}</small>
      ${draft.note ? `<small>${escapeHtml(draft.note)}</small>` : ""}
      ${unreadable.length ? `<small class="ai-draft-warn">記法として読めない語：${escapeHtml(unreadable.join("・"))}</small>` : ""}
      <button type="button" class="ghost-button small" data-ai-draft="apply" data-index="${index}">これをフォームに入れる</button>
    </article>`;
  }

  async function run() {
    if (running || !state.editing) return;
    const box = result();
    const character = document.getElementById("field-character")?.value.trim() || "";
    const text = document.getElementById("aiDraftText")?.value.trim() || "";
    const file = document.getElementById("aiDraftImage")?.files?.[0] || null;
    if (!character) { box.textContent = "先にキャラを入れてください。"; return; }
    if (!text && !file) { box.textContent = "コンボの文章か、メモの写真を入れてください。"; return; }
    running = true;
    const button = els.formFields.querySelector('[data-ai-draft="run"]');
    if (button) button.disabled = true;
    box.textContent = "下書きを作っています…（10〜30秒ほど）";
    const editing = state.editing;
    try {
      const image = file ? await shrinkImage(file).catch(() => { throw new Error("画像を読み込めませんでした。JPEG・PNGで試してください。"); }) : null;
      const payload = await sf6Request("/api/sf6/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Dashboard-Action": "sf6-ai-draft" },
        body: JSON.stringify({ character, text, ...(image ? { image } : {}) }),
      }, (body) => new Error(errorMessage(body, "下書きを作れませんでした。")));
      if (state.editing !== editing || !result()) return;
      drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
      const unclear = Array.isArray(payload.unclear) ? payload.unclear : [];
      result().innerHTML = `${drafts.length ? drafts.map(draftHtml).join("") : "<p>コンボを読み取れませんでした。</p>"}
        ${unclear.length ? `<ul class="ai-draft-unclear">${unclear.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}`;
    } catch (error) {
      if (result()) result().textContent = error instanceof Error ? error.message : "下書きを作れませんでした。";
    } finally {
      running = false;
      const retry = els.formFields.querySelector('[data-ai-draft="run"]');
      if (retry) retry.disabled = false;
    }
  }

  /** 選んだ下書きをフォームの欄に入れる。始動の状況・結果は入れない（自分で選ぶ）。 */
  function apply(index) {
    const draft = drafts[index];
    if (!draft || !state.editing) return;
    const set = (id, value) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    };
    set("field-title", draft.title);
    set("field-notation", draft.notation);
    set("field-startup", draft.startup ?? "");
    set("field-driveCost", String(draft.driveCost));
    set("field-saCost", String(draft.saCost));
    // 任意項目の欄にも入れたので、開いて確認できるようにする
    const more = els.formFields.querySelector("details.form-more");
    if (more && (draft.startup !== null || draft.driveCost || draft.saCost)) more.open = true;
    refreshNotationAssist();
    document.getElementById("notationPreview")?.scrollIntoView({ block: "nearest" });
  }

  return { run, apply };
}
