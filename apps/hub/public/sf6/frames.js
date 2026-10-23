import { escapeHtml } from "../shared/html.js";
import { stored, empty, notationHtml, formatDay } from "./format.js";
// キャラ別フレームの取得・表示と相手の技からの確定反撃条件。
import { punishWindowForMove, formatAdvantage, punishLevel, counterText, punishCounterText, searchMoves } from "../sf6-frames.js";

export function createSf6Frames({ state, els, movesOf, ensureMoves, renderTabs, renderSequences, selectTab }) {
  // ---------- フレーム ----------

  /** PC幅ではカウンター・パニカンも列で出す。table-layout: fixed なので、詳細行の colspan は見えている列の数にする。 */
  const WIDE_FRAMES = window.matchMedia("(min-width: 681px)");

  const FRAME_DETAILS = [
    ["activeText", "持続"], ["recoveryText", "硬直"], ["cancelText", "キャンセル"], ["damageText", "ダメージ"],
    ["scalingText", "補正"], ["attributeText", "属性"], ["driveGainText", "Dゲージ増加"], ["driveLossText", "Dゲージ減少"], ["saGainText", "SAゲージ増加"],
  ];

  function frameCharacters() {
    return state.data.moveSets.map((set) => set.character);
  }

  function renderPunishPicker() {
    const { character, moveId, loading, error } = state.opponent;
    const characters = frameCharacters();
    els.opponentCharacter.innerHTML = `<option value="">相手キャラを選ぶ</option>${characters.map((name) =>
      `<option value="${escapeHtml(name)}"${name === character ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
    els.opponentCharacter.disabled = !characters.length;
    const moves = movesOf(character);
    els.opponentMove.innerHTML = `<option value="">${loading ? "読み込み中…" : "相手の技を選ぶ"}</option>${moves.map((move) => {
      const window = punishWindowForMove(move);
      return `<option value="${move.id}"${move.id === moveId ? " selected" : ""}${window === null ? " disabled" : ""}>${escapeHtml(`${move.name} / ${move.command || ""} / ガード ${formatAdvantage(move.blockText) || "不明"}F`)}</option>`;
    }).join("")}`;
    els.opponentMove.disabled = loading || !moves.length;
    const selected = moves.find((move) => move.id === moveId);
    const parsedWindow = punishWindowForMove(selected);
    els.opponentMoveStatus.textContent = error || (!characters.length ? "相手キャラの技データはまだ登録されていません。不利Fを直接入力できます。"
      : character && !loading && !moves.length ? "このキャラの技データはありません。不利Fを直接入力できます。"
      : selected && parsedWindow !== null ? `${character}：${selected.name} · 発生${parsedWindow}F以内のコンボ` : "");
    els.opponentMoveRetry.hidden = !error;
  }

  async function loadOpponentMoves() {
    const character = state.opponent.character;
    state.opponent.loading = Boolean(character);
    state.opponent.error = "";
    renderPunishPicker();
    try {
      await ensureMoves(character);
    } catch (error) {
      if (state.opponent.character === character) state.opponent.error = error instanceof Error ? error.message : "技データを読み込めませんでした。";
    } finally {
      if (state.opponent.character === character) {
        state.opponent.loading = false;
        renderPunishPicker();
      }
    }
  }

  function applyOpponentMove(move) {
    const window = punishWindowForMove(move);
    if (window === null) return;
    state.opponent.moveId = move.id;
    state.conditions = { ...state.conditions, situationId: null, punishWindow: window };
    state.sequenceKind = "combo";
    renderTabs();
    renderSequences();
    els.sequenceConditions.open = true;
  }

  async function loadFrames() {
    const characters = frameCharacters();
    if (!characters.includes(state.frames.character)) {
      const last = stored("sf6-character", "");
      state.frames.character = characters.includes(last) ? last : characters[0] || "";
    }
    renderFrames();
    if (!state.frames.character || state.moves.has(state.frames.character)) return;
    try {
      await ensureMoves(state.frames.character);
      renderFrames();
    } catch (error) {
      els.frameTable.innerHTML = empty(error instanceof Error ? error.message : "技データを読み込めませんでした。");
    }
  }

  function bonusHtml(result, notes) {
    if (!result.text) return "";
    return result.overridden
      ? `<span class="override" title="${escapeHtml(notes || "備考の性能")}">${escapeHtml(result.text)}※</span>`
      : escapeHtml(result.text);
  }

  function frameRowHtml(move) {
    const open = state.frames.open === move.id;
    const level = punishLevel(move);
    const counter = counterText(move);
    const punish = punishCounterText(move);
    const overrides = [["カウンター", counter], ["パニカン", punish]]
      .filter(([, result]) => result.overridden)
      .map(([label, result]) => `<div><span>${label}</span> ${bonusHtml(result, move.notes)}</div>`).join("");
    const details = [
      ...FRAME_DETAILS.map(([key, label]) => [label, move[key] ? escapeHtml(move[key]) : ""]),
    ];
    details.splice(2, 0, ["カウンター", bonusHtml(counter, move.notes)], ["パニカン", bonusHtml(punish, move.notes)]);
    const detail = open ? `<tr class="frame-detail"><td colspan="${WIDE_FRAMES.matches ? 6 : 4}">
        <dl>${details.filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
        ${move.notes ? `<p class="memo">${escapeHtml(move.notes)}</p>` : ""}
        ${level && punishWindowForMove(move) >= 4 ? `<button type="button" class="ghost-button find-punish" data-find-punish="${move.id}">確反コンボを探す</button>` : ""}
      </td></tr>` : "";
    return `<tr class="frame-row${open ? " open" : ""}">
      <td><button type="button" class="frame-name" data-frame-row="${move.id}" aria-expanded="${open}"><span>${escapeHtml(move.name)}</span>${move.command ? notationHtml(move.command, true) : ""}</button>${overrides ? `<div class="frame-overrides">${overrides}</div>` : ""}</td>
      <td class="num">${escapeHtml(move.startupText || "")}</td>
      <td class="num${level ? ` punish ${level}` : ""}">${escapeHtml(formatAdvantage(move.blockText))}</td>
      <td class="num">${escapeHtml(formatAdvantage(move.hitText))}</td>
      <td class="num wide">${bonusHtml(counter, move.notes)}</td>
      <td class="num wide">${bonusHtml(punish, move.notes)}</td>
    </tr>${detail}`;
  }

  function renderFrames() {
    const characters = frameCharacters();
    els.frameCharacter.innerHTML = characters.map((character) =>
      `<option value="${escapeHtml(character)}"${character === state.frames.character ? " selected" : ""}>${escapeHtml(character)}</option>`).join("");
    els.frameCategory.querySelectorAll("[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.frames.category));
    });
    els.frameSort.value = state.frames.sort;
    els.framePunishable.setAttribute("aria-pressed", String(state.frames.punishableOnly));
    els.frameHeavyPunishable.setAttribute("aria-pressed", String(state.frames.heavyPunishableOnly));
    els.frameCancelable.setAttribute("aria-pressed", String(state.frames.cancelableOnly));
    if (!characters.length) {
      els.frameVersion.textContent = "";
      els.frameTable.innerHTML = empty("フレームはまだ登録されていません（登録方法はヘルプ）");
      return;
    }
    const data = state.moves.get(state.frames.character);
    if (!data) {
      els.frameVersion.textContent = "";
      els.frameTable.innerHTML = '<div class="state-card"><span class="spinner"></span></div>';
      return;
    }
    els.frameVersion.innerHTML = data.set
      ? `${escapeHtml(data.set.dataVersion)} · ${escapeHtml(formatDay(data.set.checkedOn))}確認 · <a href="${escapeHtml(data.set.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式</a>`
      : "";
    const list = searchMoves(data.moves, state.frames);
    els.frameTable.innerHTML = list.length
      ? `<table class="frame-table">
          <thead><tr><th>技名 / コマンド</th><th class="num">発生</th><th class="num">ガード</th><th class="num">ヒット</th><th class="num wide">カウンター</th><th class="num wide">パニカン</th></tr></thead>
          <tbody>${list.map(frameRowHtml).join("")}</tbody>
        </table>`
      : empty("条件に合う技はありません");
  }

  /** ガードした相手の技から、確定反撃のコンボを引く（不利F＝ガード時の不利）。 */
  function findPunish(moveId) {
    const move = movesOf(state.frames.character).find((entry) => entry.id === moveId);
    if (punishWindowForMove(move) === null) return;
    state.opponent = { character: state.frames.character, moveId, loading: false, error: "" };
    state.sequenceCharacter = stored("sf6-character", state.sequenceCharacter);
    state.sequencePosition = "";
    selectTab("sequences");
    applyOpponentMove(move);
    window.scrollTo({ top: 0 });
  }

  return { WIDE_FRAMES, renderPunishPicker, loadOpponentMoves, applyOpponentMove, loadFrames, renderFrames, findPunish };
}
