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
  assert.match(html, /data-view="archived"/);
  assert.match(html, /data-summary-status="ideas"/);
  assert.match(html, /id="questionInput"/);
  assert.match(html, /id="notesInput"/);
  assert.match(html, /id="editorStatus"/);
  assert.match(html, /id="sourceWantLink"/);
  assert.match(html, /CompassでWantを「Writing」に振り分けます/);
  assert.match(script, /fetch\("\/api\/writing"/);
  assert.match(script, /"X-Dashboard-Action": "writing-update"/);
  assert.match(script, /originalUpdatedAt: item\.updatedAt/);
  assert.match(script, /\/compass\/\?view=wants&id=\$\{item\.sourceWantId\}/);
  assert.match(script, /\["completed", "archived"\]\.includes\(item\.status\)/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /指定されたWritingテーマを開けません/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
