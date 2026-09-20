import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Writing page manages themes separately from completed work", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/writing/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/writing.js", import.meta.url), "utf8"),
    readFile(new URL("../public/writing.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1>Writing<\/h1>/);
  assert.match(html, /data-view="active"/);
  assert.match(html, /data-view="completed"/);
  assert.doesNotMatch(html, /data-view="archived"/);
  assert.match(html, /data-summary-status="candidate"/);
  assert.match(html, /Pomeraで執筆中/);
  assert.match(html, /役目を終えたテーマ/);
  assert.match(html, /id="questionInput"/);
  assert.doesNotMatch(html, /id="notesInput"|id="nextReviewInput"|id="draftUrlInput"/);
  assert.match(html, /id="editorStatus"/);
  assert.match(html, /id="sourceWantLink"/);
  assert.match(html, /本文はPomeraで執筆/);
  assert.match(html, /id="boardTitle">Pomeraで書くテーマ/);
  assert.doesNotMatch(html, /タイトル・論点・メモ/);
  assert.match(script, /fetch\("\/api\/writing"/);
  assert.match(script, /"X-Dashboard-Action": "writing-update"/);
  assert.match(script, /originalUpdatedAt: item\.updatedAt/);
  assert.match(script, /\/compass\/\?view=wants&id=\$\{item\.sourceWantId\}/);
  assert.match(script, /function workflowStatus\(status\)/);
  assert.match(script, /return "candidate"/);
  assert.doesNotMatch(script, /notesInput|nextReviewInput|draftUrlInput/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /指定されたWritingテーマを開けません/);
  assert.match(css, /--accent: #7a3f62/);
  assert.match(css, /\.brand span \{[^}]*background: var\(--accent\)/);
  assert.match(css, /\.topic-status\.drafting \{ background: var\(--accent-soft\); color: var\(--accent\); \}/);
  assert.doesNotMatch(css, /--green: #245949/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
