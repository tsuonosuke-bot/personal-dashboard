import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Knowledge uses the shared dashboard shell and requested title", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>Knowledge — Personal Hub<\/title>/);
  assert.match(app, /<h1>Knowledge<\/h1>/);
  assert.match(app, /className="dashboard-switcher"/);
  assert.match(app, /<summary aria-label="ページを切り替える">/);
  assert.match(app, /className="dashboard-switcher-icon"/);
  // 接続状態は確認中と失敗のときだけ出し、正常時の飾りの表示はしない
  assert.doesNotMatch(app, /SUPABASE LIVE/);
  assert.match(app, /\{\(error \|\| loading\) && \(/);
  // 説明はヘッダーではなくヘルプページへ
  assert.doesNotMatch(app, /学びを整理・確認/);
  assert.match(app, /onClick=\{\(\) => setHelpOpen\(true\)\} aria-label="ヘルプ"/);
  assert.match(app, />Idea<\/a>/);
  assert.match(app, />Finance<\/a>/);
  assert.match(css, /width: min\(1240px, calc\(100% - 24px\)\)/);
  assert.match(css, /min-height: 48px/);
  assert.doesNotMatch(css, /content:\s*"▦"/);
  // デスクトップは32px、スマホ幅は押しやすい40pxにそろえる
  assert.match(css, /\.head-actions button, \.hub-link \{ height: 32px; min-height: 32px;/);
  assert.match(css, /\.dashboard-switcher summary \{ width: 40px; height: 40px; min-height: 40px;/);
  assert.match(css, /\.head-actions button, \.hub-link \{ height: 40px; min-height: 40px;/);
});

test("ページ上部のボタンは高さと折り返しを揃え、問い・示唆を先頭に置き、低頻度のものはその他にまとめる", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /className="page-tool page-tool-primary"\s+onClick=\{\(\) => setOrganizeOpen\("questions"\)\}/);
  assert.match(app, /<span className="page-tool-count" aria-hidden="true">示唆 \{insightStore\.insights\.length\}<\/span>/);
  // JSON書き出し・接続状態は「その他」の中だけに置く
  const more = app.slice(app.indexOf('<details className="page-tool-more">'));
  assert.match(more, /<summary className="page-tool">その他<\/summary>[\s\S]*href="api\/export">JSON書き出し<[\s\S]*>接続状態<\/a>\s*<\/div>\s*<\/details>/);
  assert.equal(app.match(/href="api\/export"/g)?.length, 1);

  assert.match(css, /\.page-tool \{ height: 32px;[^}]*white-space: nowrap;/);
  // 枠も塗りもないボタンにし、問い・示唆は文字の濃さだけで目立たせる
  assert.match(css, /\.page-tool \{[^}]*border: 0;[^}]*background: transparent;/);
  assert.match(css, /\.page-tool-primary \{ margin-right: auto; color: var\(--text\); font-weight: 500; \}/);
  // スマホ幅では押しやすい高さにする
  assert.match(css, /  \.page-tool \{ height: 40px; \}/);
});
