// ホームの表示設定のうち、DOMに触れない部分。欄の一覧は index.html の data-home-section が正本。
export const HOME_HIDDEN_KEY = "hub-home-hidden";

/** @type {typeof import("./home-sections.d.ts").parseHidden} */
export function parseHidden(value) {
  return String(value || "").split(" ").filter(Boolean);
}

/** 非表示の欄をAPIへ伝えて、その欄だけが使う取得元を読まずに済ませる。 */
/** @type {typeof import("./home-sections.d.ts").hubUrl} */
export function hubUrl(hidden) {
  return hidden.length ? `/api/hub?hidden=${hidden.map(encodeURIComponent).join(",")}` : "/api/hub";
}

/** 非表示から表示に変わった欄。読み込んでいないデータがあるので取り直す。 */
/** @type {typeof import("./home-sections.d.ts").revealedSections} */
export function revealedSections(previous, next) {
  return previous.filter((key) => !next.includes(key));
}

/** @type {typeof import("./home-sections.d.ts").sameSections} */
export function sameSections(left, right) {
  return left.length === right.length && left.every((key) => right.includes(key));
}
