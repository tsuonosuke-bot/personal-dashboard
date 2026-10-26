/** ユーザー由来の文字列をHTMLのテキスト・引用符付き属性へ埋め込む。URLの許可判定は呼び出し側で行う。 */
/** @type {typeof import("./html.d.ts").escapeHtml} */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
