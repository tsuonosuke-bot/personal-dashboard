import { appendToken, removeLastToken } from "./sf6-notation.js";

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const ATTACKS = { u: "弱P", i: "中P", o: "強P", j: "弱K", k: "中K", l: "強K" };
const SHORTCUTS = { " ": ">", x: "xx", q: "J", r: "DR", f: "DI", p: "パリィ", t: "投げ", c: "TC" };

function shortcut(event) {
  const key = event.key.toLowerCase();
  if (ATTACKS[key]) return event.shiftKey ? (ATTACKS[key].endsWith("P") ? "PP" : "KK") : ATTACKS[key];
  // Shift+数字は配列によって記号が変わるので、物理キーからSA/CAを読む。
  const digit = event.code?.match(/^(?:Digit|Numpad)([1-9])$/)?.[1] || (/^[1-9]$/.test(key) ? key : null);
  if (event.shiftKey) return digit && Number(digit) <= 4 ? ["SA1", "SA2", "SA3", "CA"][Number(digit) - 1] : null;
  if (digit) return digit;
  if (key === "backspace") return "backspace";
  return SHORTCUTS[key] || null;
}

/**
 * フォーカス中のレシピ欄だけで使う入力。矢印を全部離すまでを1方向とし、同時押しは斜めに置き換える。
 * read/write は既存のパレットと同じテキストを使う。DOMに触れず、blur・閉じる操作では reset する。
 */
export function createNotationKeyboard({ read, write }) {
  const arrows = new Set();
  let beforeArrow = null;

  function reset() {
    arrows.clear();
    beforeArrow = null;
  }

  return {
    reset,
    keydown(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) {
        reset();
        return false;
      }
      const isArrow = ARROW_KEYS.has(event.key) && !event.shiftKey;
      const token = isArrow ? null : shortcut(event);
      if (!isArrow && !token) return false;
      // 長押しで方向や技が連続入力されないようにする。スクロールなどの既定動作は引き続き抑える。
      if (event.repeat) return true;
      if (isArrow) {
        if (beforeArrow === null) beforeArrow = read();
        arrows.add(event.key);
        const x = Number(arrows.has("ArrowRight")) - Number(arrows.has("ArrowLeft"));
        const y = Number(arrows.has("ArrowUp")) - Number(arrows.has("ArrowDown"));
        write(appendToken(beforeArrow, String(5 + x + y * 3)));
      } else {
        beforeArrow = null;
        write(token === "backspace" ? removeLastToken(read()) : appendToken(read(), token));
      }
      return true;
    },
    keyup(event) {
      arrows.delete(event.key);
      if (!arrows.size) beforeArrow = null;
    },
  };
}
