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
  assert.match(html, /id="habitsLink"/);
  assert.match(html, /id="financialLink"/);
  assert.match(html, /id="knowledgeLink"/);
  assert.match(html, /id="reviewStartLink"/);
  assert.match(html, /id="habitMetricLink"/);
  assert.match(html, /class="metric-grid"/);
  assert.match(html, /id="wantList"/);
  assert.match(html, /id="focusList"/);
  assert.match(html, /id="manageFocusButton"/);
  assert.match(html, /id="focusModal"/);
  assert.match(html, /id="allWantsLink"/);
  assert.match(html, /id="journalList"/);
  assert.match(html, /過去のJournal/);
  assert.match(html, /読み取り専用/);
  assert.match(script, /renderWants\(payload\.wants, payload\.navigation\.compass, availability\.wants\)/);
  assert.match(script, /renderFocus\(payload\.focus \|\| \[\], availability\.focus\)/);
  assert.match(script, /fetch\("\/api\/focus"/);
  assert.match(script, /"X-Dashboard-Action": action/);
  assert.match(script, /focus-update/);
  assert.match(script, /focus-reorder/);
  assert.match(script, /表示から外す/);
  assert.match(script, /renderJournal\(payload\.journalMoments, availability\.journal\)/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
  assert.match(script, /reviewStartLink\.href = navigation\.knowledgeReview/);
  assert.match(script, /一部取得不可/);
  assert.match(script, /renderExpenses\(payload\.recentExpenses, availability\.expenses\)/);
  assert.doesNotMatch(`${html}\n${script}`, /再訪日|再訪期限/);
});

test("Hub adds Habits as a fourth compact navigation choice", async () => {
  const css = await readFile(new URL("../public/hub.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.dashboard-grid \{ display: grid; grid-template-columns: repeat\(4, 1fr\);/);
  assert.match(css, /\.dashboard-grid \{ gap: 5px; \}/);
  assert.match(css, /\.dashboard-card \{ min-height: 88px;/);
  assert.match(css, /\.metric-grid \{ grid-template-columns: 1fr 1fr;/);
  assert.match(css, /\.journal-list \{ grid-template-columns: 1fr; \}/);
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

test("Compass edits Wants through a dedicated API", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="editWantButton"/);
  assert.match(script, /endpoint: "\/api\/wants"/);
  assert.match(script, /actionHeader: "want-update"/);
});

test("Compass previews every route and requires explicit confirmation for Google Calendar", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="untriagedWants"/);
  assert.match(script, /id="triageWantButton"/);
  assert.match(script, /function renderTriageStart\(item\)/);
  assert.match(script, /function renderRoutePreview\(item, plan\)/);
  assert.match(script, /fetch\("\/api\/want-routes"/);
  assert.match(script, /X-Dashboard-Action": "want-route-create"/);
  assert.match(script, /外部へ送信せず、登録計画だけを保存/);
  assert.match(script, /id="routeCalendarDate"/);
  assert.match(script, /Google Calendarに登録/);
  assert.match(script, /fetch\("\/api\/google-calendar-status"/);
  assert.match(script, /Google Calendarを再接続/);
  assert.match(script, /href="\/api\/google-calendar-connect"/);
  assert.match(script, /calendar: plan\.calendar \|\| null/);
});

test("Compass keeps Google Calendar reconnection available from the main screen", async () => {
  const html = await readFile(new URL("../public/compass/index.html", import.meta.url), "utf8");

  assert.match(html, /class="calendar-connect-link"/);
  assert.match(html, /href="\/api\/google-calendar-connect"/);
  assert.match(html, />Calendar再接続<\/a>/);
});

test("Compass asks AI only on explicit action and sends suggestions through human review", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="askAiTriageButton"/);
  assert.match(script, /askAiTriageButton"\)\.addEventListener\("click", \(\) => requestAiTriage\(item\)\)/);
  assert.match(script, /押した時だけ、Want本文をClaude APIへ送信/);
  assert.match(script, /fetch\("\/api\/want-suggestions"/);
  assert.match(script, /X-Dashboard-Action": "want-ai-suggest"/);
  assert.match(script, /回答をもとに再提案/);
  assert.match(script, /この案を使う/);
  assert.match(script, /renderRouteForm\(item, suggestion\.intent, suggestion\.destination, suggestion\)/);
  assert.match(script, /これは未保存の案です/);
});

test("Compass closes actionable Inbox and Wants with conflict-safe updates", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /inbox:[\s\S]*closedStatus: "done"/);
  assert.match(script, /wants:[\s\S]*closedStatus: "completed"/);
  assert.match(script, /id="closeItemButton"/);
  assert.match(script, /function canCloseItem\(item, view\)/);
  assert.match(script, /cancelled", "archived"/);
  assert.match(script, /if \(!window\.confirm\(meta\.confirm\)\) return/);
  assert.match(script, /original: \{ content: item\.content, status: item\.status, result: item\.result \}/);
  assert.match(script, /original: \{ content: item\.content, status: item\.status \}/);
  assert.match(script, /const refreshed = await loadDashboard\(\)/);
});

test("Compass promotes Inbox content to a Want", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="createWantButton"/);
  assert.match(script, /actionHeader: "want-create"/);
  assert.match(script, /async function markInboxPromoted\(sourceItem\)/);
  assert.match(script, /status: "done",\s+result: "Wantsに登録"/);
  assert.match(script, /"X-Dashboard-Action": "inbox-update"/);
  assert.match(script, /Wantは追加しましたが、Inboxを処理済みにできませんでした/);
  assert.match(script, /Want追加後、元のInboxを処理済みにし/);
  assert.doesNotMatch(script, /action-create|action-update|createActionButton|editActionButton/);
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

test("Compass defaults each tab to actionable items and counts the filtered results", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /status: "pending"/);
  assert.match(script, /inbox: "pending",\s+wants: "active",/);
  assert.match(script, /function setView\(view, filter = defaultStatusByView\[view\]\)/);
  assert.match(script, /function renderCurrentTabCount\(items\)/);
  assert.match(script, /countElement\.textContent = items\.length/);
});
