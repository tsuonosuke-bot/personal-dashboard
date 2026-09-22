import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Writing page manages themes separately from completed work", async () => {
  const [html, script, css, shell] = await Promise.all([
    readFile(new URL("../public/writing/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/writing.js", import.meta.url), "utf8"),
    readFile(new URL("../public/writing.css", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard-shell.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1>Writing<\/h1>/);
  assert.match(html, /data-view="candidate"/);
  assert.match(html, /data-view="completed"/);
  assert.doesNotMatch(html, /data-view="archived"/);
  assert.match(html, /data-summary-view="candidate"/);
  assert.match(html, /アイデア/);
  assert.match(html, /完了/);
  assert.doesNotMatch(html, /Pomeraで執筆中|書き上げ/);
  assert.match(html, /id="questionInput"/);
  assert.doesNotMatch(html, /id="notesInput"|id="nextReviewInput"|id="draftUrlInput"/);
  assert.match(html, /id="editorStatus"/);
  assert.match(html, /id="sourceWantLink"/);
  assert.match(html, /本文はPomeraで執筆/);
  assert.match(html, /id="boardTitle">アイデア/);
  assert.doesNotMatch(html, /タイトル・論点・メモ/);
  assert.match(script, /fetch\("\/api\/writing"/);
  assert.match(script, /"X-Dashboard-Action": "writing-update"/);
  assert.match(script, /originalUpdatedAt: item\.updatedAt/);
  assert.match(script, /\/compass\/\?view=wants&id=\$\{item\.sourceWantId\}/);
  assert.doesNotMatch(script, /workflowStatus|drafting/);
  assert.doesNotMatch(script, /notesInput|nextReviewInput|draftUrlInput/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /指定されたWritingテーマを開けません/);
  assert.match(css, /--accent: #7a3f62/);
  assert.match(html, /class="dashboard-brand-mark writing"/);
  assert.match(shell, /\.dashboard-brand-mark\.writing \{ background: #7a3f62/);
  assert.doesNotMatch(css, /\.topic-status\.drafting/);
  assert.doesNotMatch(css, /--green: #245949/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
