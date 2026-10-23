import { escapeHtml } from "../shared/html.js";
import { ARROWS, parseNotation } from "../sf6-notation.js";

export function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても表示は続ける
  }
}

export function formatDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
}

export function daysAgo(value, today) {
  if (!value || !today) return "";
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86_400_000);
  return diff <= 0 ? "今日" : diff === 1 ? "昨日" : `${diff}日前`;
}

export function percent(successes, attempts) {
  return attempts > 0 ? `${Math.round((successes / attempts) * 100)}%` : "—";
}

export function empty(message) {
  return `<div class="empty"><p>${escapeHtml(message)}</p></div>`;
}

export function errorMessage(payload, fallback) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  return fallback;
}

/** map は { 値: ラベル } か、並び順を決めたいときの [[値, ラベル], …]。 */
export function options(map, selected) {
  return (Array.isArray(map) ? map : Object.entries(map)).map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

export function chips(list) {
  return list.length ? `<div class="tags">${list.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

/** レシピを矢印と色付きのボタンで表示する。読めない語は文字のまま出す。inline はフレーム表のコマンド用。 */
export function notationHtml(text, inline = false) {
  const parts = parseNotation(text).map((part) => {
    if (part.type === "command" || part.type === "motion") {
      const jump = part.jump ? '<span class="cmd-jump" title="ジャンプ">J</span>' : "";
      const arrows = part.arrows.length ? `<span class="cmd-arrows">${part.arrows.map(escapeHtml).join("")}</span>` : "";
      const button = part.type === "command"
        ? `<span class="cmd-button ${part.limb} ${part.strength}">${escapeHtml(part.button)}</span>`
        : "";
      return `<span class="cmd">${jump}${arrows}${button}</span>`;
    }
    if (part.type === "link") return `<span class="cmd-link ${part.kind}" title="${escapeHtml(part.title)}">${escapeHtml(part.label)}</span>`;
    return `<span class="cmd-text">${escapeHtml(part.text)}</span>`;
  });
  return inline
    ? `<span class="notation inline" aria-label="${escapeHtml(text)}">${parts.join("")}</span>`
    : `<div class="notation" aria-label="${escapeHtml(text)}">${parts.join("")}</div>`;
}

export const PALETTE = {
  directions: ["7", "8", "9", "4", "5", "6", "1", "2", "3"],
  attacks: ["弱P", "中P", "強P", "PP", "弱K", "中K", "強K", "KK"],
  motions: [["236", "波動"], ["214", "竜巻"], ["623", "昇龍"], ["41236", "半回転"], ["22", "↓↓"], ["J", "ジャンプ"]],
  links: [">", "xx", "TC", "DR", "DI", "パリィ", "投げ", "SA1", "SA2", "SA3", "CA"],
  moves: ["前ステ", "バクステ", "前歩き", "微歩き", "垂直J", "前J", "空振り", "重ね", "待ち"],
};

export const LINK_LABELS = { ">": "› つなぎ", xx: "キャンセル" };

/** withMoves: 起き攻め用に移動・タイミングの基準の行を先頭に出す。 */
export function paletteHtml(withMoves) {
  const key = (token, label, className = "") =>
    `<button type="button" class="pal-key ${className}" data-token="${escapeHtml(token)}">${escapeHtml(label)}</button>`;
  return `<div class="palette" role="group" aria-label="手順の入力パレット">
    ${withMoves ? `<div class="pal-row">${PALETTE.moves.map((token) => key(token, token, "move")).join("")}</div>` : ""}
    <div class="pal-row pal-main">
      <div class="pal-pad">${PALETTE.directions.map((digit) => key(digit, ARROWS[digit], "dir")).join("")}</div>
      <div class="pal-attacks">${PALETTE.attacks.map((button) => key(button, button, `atk ${button.endsWith("P") ? "punch" : "kick"}`)).join("")}</div>
    </div>
    <div class="pal-row">${PALETTE.motions.map(([token, label]) => key(token, label, "motion")).join("")}</div>
    <div class="pal-row">${PALETTE.links.map((token) => key(token, LINK_LABELS[token] || token, "link")).join("")}</div>
    <div class="pal-row pal-edit">
      <button type="button" class="pal-key edit" data-palette="keyboard">⌨ キーボード入力</button>
      <button type="button" class="pal-key edit" data-palette="backspace">⌫ 1つ戻す</button>
      <button type="button" class="pal-key edit" data-palette="clear">クリア</button>
    </div>
  </div>`;
}
