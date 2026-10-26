/** 非表示タブのHTMLは作らず、切り替え時に現在のデータから描く。 */
export function renderSf6VisibleTab(tab, renderers) {
  renderers[tab]?.();
}
