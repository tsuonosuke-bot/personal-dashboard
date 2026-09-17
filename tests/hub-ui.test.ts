import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hub keeps navigation and summary compact without a greeting hero", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/hub.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /class="hero"|DAILY OVERVIEW|TODAY AT A GLANCE/);
  assert.doesNotMatch(script, /おはようございます|こんにちは。|おつかれさまです/);
  assert.match(html, /id="compassLink"/);
  assert.match(html, /id="financialLink"/);
  assert.match(html, /id="knowledgeLink"/);
  assert.match(html, /class="metric-grid"/);
});

test("mobile Hub retains three navigation choices in one row", async () => {
  const css = await readFile(new URL("../public/hub.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.dashboard-grid \{ gap: 5px; \}/);
  assert.match(css, /\.dashboard-card \{ min-height: 88px;/);
  assert.match(css, /\.metric-grid \{ grid-template-columns: 1fr 1fr;/);
});

test("Compass exposes a real Inbox create menu", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="addInboxButton"/);
  assert.match(html, /id="inboxForm"/);
  assert.match(html, /maxlength="2000"/);
  assert.match(script, /fetch\("\/api\/inbox"/);
  assert.match(script, /X-Dashboard-Action.*inbox-create/s);
});

test("Compass edits an Inbox and reloads the canonical data", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="editInboxButton"/);
  assert.match(script, /method: "PATCH"/);
  assert.match(script, /X-Dashboard-Action": "inbox-update"/);
  assert.match(script, /const refreshed = await loadDashboard\(\)/);
});

test("Compass edits Wants and Next Actions through dedicated APIs", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="editWantButton"/);
  assert.match(script, /id="editActionButton"/);
  assert.match(script, /endpoint: "\/api\/wants"/);
  assert.match(script, /actionHeader: "want-update"/);
  assert.match(script, /endpoint: "\/api\/actions"/);
  assert.match(script, /actionHeader: "action-update"/);
});

test("Compass promotes Inbox content to a Want and breaks a Want into a Next Action", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="createWantButton"/);
  assert.match(script, /id="createActionButton"/);
  assert.match(script, /actionHeader: "want-create"/);
  assert.match(script, /actionHeader: "action-create"/);
  assert.match(script, /sourceView === "wants" \? \{ wantId: sourceItem\.id, content \} : \{ content \}/);
  assert.match(script, /元のInboxはそのまま残ります/);
});

test("Compass starts with the summary and omits the decorative hero and large date", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /class="hero"|PERSONAL DIRECTION|頭の中を、|hero-date|dayLabel|dateLabel|updatedLabel/);
  assert.doesNotMatch(script, /setClock|dayLabel|dateLabel|updatedLabel/);
  assert.match(html, /<main>\s*<section class="metrics"/);
});
