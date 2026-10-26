// SF6のコンボレシピ（クラシック操作）。保存はテキストのまま（例: "2中K > DR 5中P > 2強P xx 236強P"）で、
// 入力パレットの組み立てと、カード表示用の分解だけをここで行う。DOMに触れないのでテストから直接読める。

// 単独の P / K は強さを問わないボタン（SAのコマンド "236236P" など）。パレットにはキーを置かない
const ATTACK = "(?:弱|中|強)[PK]|PP|KK|P|K";
const PREFIX_ONLY = /^J?[1-9]*$/;
const ATTACK_ONLY = new RegExp(`^(?:${ATTACK})$`);
const COMMAND = new RegExp(`^(J)?([1-9]*)(${ATTACK})$`);
const TRAILING_ATTACK = new RegExp(`(?:${ATTACK})$`);

/** @type {Record<string, string>} */
export const ARROWS = { 1: "↙", 2: "↓", 3: "↘", 4: "←", 5: "N", 6: "→", 7: "↖", 8: "↑", 9: "↗" };

/** つなぎの記号。カードでは小さく、または色付きの札で表示する。 */
/** @type {typeof import("./sf6-notation.d.ts").LINKS} */
export const LINKS = {
  ">": { label: "›", kind: "link", title: "つなぎ" },
  xx: { label: "キャンセル", kind: "cancel", title: "キャンセル" },
  TC: { label: "TC", kind: "cancel", title: "ターゲットコンボ" },
  DR: { label: "DR", kind: "drive", title: "ドライブラッシュ" },
  DI: { label: "DI", kind: "drive", title: "ドライブインパクト" },
  パリィ: { label: "パリィ", kind: "drive", title: "ドライブパリィ" },
  投げ: { label: "投げ", kind: "drive", title: "投げ" },
  SA1: { label: "SA1", kind: "sa", title: "SA1" },
  SA2: { label: "SA2", kind: "sa", title: "SA2" },
  SA3: { label: "SA3", kind: "sa", title: "SA3" },
  CA: { label: "CA", kind: "sa", title: "クリティカルアーツ" },
  // 起き攻めの手順で使う移動・タイミングの基準
  前ステ: { label: "前ステ", kind: "move", title: "前ステップ" },
  バクステ: { label: "バクステ", kind: "move", title: "バックステップ" },
  前歩き: { label: "前歩き", kind: "move", title: "前歩き" },
  微歩き: { label: "微歩き", kind: "move", title: "少しだけ前歩き" },
  垂直J: { label: "垂直J", kind: "move", title: "垂直ジャンプ" },
  前J: { label: "前J", kind: "move", title: "前ジャンプ" },
  空振り: { label: "空振り", kind: "move", title: "次の技を空振りして時間を合わせる" },
  重ね: { label: "重ね", kind: "move", title: "次の技を起き上がりに重ねる" },
  待ち: { label: "待ち", kind: "move", title: "何もせず待つ" },
};

/** @param {string} text */
function tokensOf(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

/**
 * パレットで押した部品をレシピの末尾に足す。方向（数字）とジャンプ（J）は、
 * 続く方向・攻撃ボタンと1語にまとめる（例: 2 → 3 → 6 → 強P で "236強P"）。
 */
/** @type {typeof import("./sf6-notation.d.ts").appendToken} */
export function appendToken(text, token) {
  const tokens = tokensOf(text);
  const last = tokens.at(-1);
  const joins = last !== undefined && PREFIX_ONLY.test(last)
    && (/^[1-9]+$/.test(token) || ATTACK_ONLY.test(token));
  if (joins) tokens[tokens.length - 1] = last + token;
  else tokens.push(token);
  return tokens.join(" ");
}

/** 最後に足した部品を1つ消す。"236強P" なら強P、"236" なら6、それ以外は最後の1語。 */
/** @type {typeof import("./sf6-notation.d.ts").removeLastToken} */
export function removeLastToken(text) {
  const tokens = tokensOf(text);
  const last = tokens.pop();
  if (last === undefined) return "";
  let rest = "";
  if (COMMAND.test(last) && !ATTACK_ONLY.test(last)) rest = last.replace(TRAILING_ATTACK, "");
  else if (/^J?[1-9]{2,}$/.test(last)) rest = last.slice(0, -1);
  else if (/^J[1-9]$/.test(last)) rest = "J";
  if (rest) tokens.push(rest);
  return tokens.join(" ");
}

/**
 * レシピを表示用の部品に分ける。読めない語はそのまま文字として返すので、手で書いた古いレシピも壊れない。
 * strength は light / medium / heavy / od（PP・KK）/ any（強さを問わない P・K）。
 * @returns {Array<{type: "command", jump: boolean, arrows: string[], button: string, strength: string, limb: string}
 *   | {type: "motion", arrows: string[]} | {type: "link", label: string, kind: string, title: string} | {type: "text", text: string}>}
 */
/** @type {typeof import("./sf6-notation.d.ts").parseNotation} */
export function parseNotation(text) {
  return tokensOf(text).map((token) => {
    const command = token.match(COMMAND);
    if (command) {
      const [, jump, directions, button] = command;
      const doubled = button === "PP" || button === "KK";
      return {
        type: "command",
        jump: Boolean(jump),
        // 5（ニュートラル）だけのときは矢印を出さない
        arrows: directions === "5" ? [] : [...directions].map((digit) => ARROWS[digit]),
        button,
        strength: doubled ? "od" : button.length === 1 ? "any" : button[0] === "弱" ? "light" : button[0] === "中" ? "medium" : "heavy",
        limb: button.endsWith("P") ? "punch" : "kick",
      };
    }
    if (/^J?[1-9]+$/.test(token)) {
      return { type: "motion", jump: token.startsWith("J"), arrows: [...token.replace("J", "")].map((digit) => ARROWS[digit]) };
    }
    if (Object.prototype.hasOwnProperty.call(LINKS, token)) return { type: "link", ...LINKS[token] };
    return { type: "text", text: token };
  });
}

/**
 * 登録済みのレシピから、よく使う出だしを拾う。">" で区切った最初の1区間・2区間を候補にし、
 * 使われた回数の多い順に返す（同数なら短い順）。
 */
/** @type {typeof import("./sf6-notation.d.ts").frequentFragments} */
export function frequentFragments(notations, limit = 6) {
  const counts = new Map();
  for (const notation of notations) {
    const tokens = tokensOf(notation);
    const seen = new Set();
    let segments = 0;
    for (let index = 0; index < tokens.length && segments < 2; index += 1) {
      if (tokens[index] !== ">" && tokens[index] !== "xx") continue;
      segments += 1;
      const fragment = tokens.slice(0, index + 1).join(" ");
      if (fragment !== tokens.join(" ")) seen.add(fragment);
    }
    seen.forEach((fragment) => counts.set(fragment, (counts.get(fragment) || 0) + 1));
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([fragment]) => fragment);
}

/** レシピの末尾に、よく使う出だしなどの複数語をまとめて足す。 */
/** @type {typeof import("./sf6-notation.d.ts").appendFragment} */
export function appendFragment(text, fragment) {
  return tokensOf(fragment).reduce((current, token) => appendToken(current, token), text);
}
