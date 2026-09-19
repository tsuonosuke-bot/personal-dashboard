// Basic認証で保護された個人用データを扱うため、レスポンスはキャッシュしない。
// ホーム画面からの起動を可能にするための最小限のfetchハンドラのみ持つ。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
