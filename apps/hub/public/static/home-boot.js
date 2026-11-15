// ホームの表示設定を、最初の描画より前に当てる。端末に置くのは欄の名前だけで、内容は保存しない。
// 前回の設定がこの端末にあれば html[data-home-hidden] にすぐ反映し、なければ hub.js が設定を読むまで欄を出さない。
(() => {
  try {
    const hidden = JSON.parse(window.localStorage.getItem("hub-home-hidden") || "null");
    if (!Array.isArray(hidden)) return;
    const root = document.documentElement;
    root.dataset.homeHidden = hidden.filter((key) => typeof key === "string" && /^[a-z]+$/.test(key)).join(" ");
    root.dataset.homeReady = "";
  } catch {
    // 保存先を読めない端末では、設定の取得を待ってから表示する。
  }
})();
