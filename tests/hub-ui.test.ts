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
  assert.match(html, /id="projectsLink"/);
  assert.match(html, /id="habitsLink"/);
  assert.match(html, /id="financialLink"/);
  assert.match(html, /id="knowledgeLink"/);
  assert.match(html, /id="reviewMetricLink"/);
  assert.match(html, /今日の復習を開始 →/);
  assert.doesNotMatch(html, /id="reviewStartLink"|id="spendMetricLink"|id="currentMonthSpend"|id="pendingInbox"|id="untriagedMetricLink"|id="untriagedWants"|id="oldestUntriaged"/);
  assert.match(html, /id="habitMetricLink"/);
  assert.match(html, /id="writingLink"/);
  assert.match(html, /class="dashboard-card writing-card" id="writingLink"/);
  assert.match(html, /id="projectsMeta">—/);
  assert.match(html, /id="writingMeta">—/);
  assert.doesNotMatch(html, /目標をNext Actionへ|Pomeraで書くテーマ/);
  assert.ok(html.indexOf('id="hubContent"') < html.indexOf('class="data-tools"'));
  assert.match(html, /class="metric-grid"/);
  assert.match(html, /id="inboxList"/);
  assert.match(html, /未整理のInbox/);
  assert.match(html, /id="focusList"/);
  assert.match(html, /id="manageFocusButton"/);
  assert.match(html, /id="focusModal"/);
  assert.match(html, /id="allInboxLink"/);
  assert.match(html, /id="journalList"/);
  assert.match(html, /過去のJournal/);
  assert.match(html, /読み取り専用/);
  assert.match(script, /renderInbox\(payload\.inbox \|\| \[\], availability\.inbox\)/);
  assert.match(script, /labeledCount\("進行中", summary\.activeProjects\)/);
  assert.match(script, /labeledCount\("アイデア", summary\.writingIdeas\)/);
  assert.match(script, /Inboxを取得できませんでした/);
  assert.match(script, /未整理のInboxはありません/);
  assert.match(script, /class="inbox-state">未整理/);
  assert.match(script, /escapeHtml\(item\.url \|\| "\/compass\/\?view=inbox"\)/);
  assert.match(script, /renderFocus\(payload\.focus \|\| \[\], availability\.focus\)/);
  assert.match(script, /`\$\{summary\.completedKnowledgeToday\} \/ \$\{summary\.todayKnowledgeTotal\}`/);
  assert.match(script, /fetch\("\/api\/focus"/);
  assert.match(script, /"X-Dashboard-Action": action/);
  assert.match(script, /focus-update/);
  assert.match(script, /focus-reorder/);
  assert.match(script, /表示から外す/);
  assert.match(script, /renderJournal\(payload\.journalMoments, availability\.journal\)/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
  assert.match(script, /reviewMetricLink\.href = navigation\.knowledgeReview/);
  assert.doesNotMatch(script, /reviewStartLink|spendMetricLink|spendComparison|els\.currentMonthSpend|els\.pendingInbox|untriagedMetricLink|oldestUntriaged|renderWants/);
  assert.match(script, /一部取得不可/);
  assert.match(script, /renderExpenses\(payload\.recentExpenses, availability\.expenses\)/);
  assert.doesNotMatch(`${html}\n${script}`, /再訪日|再訪期限/);
});

test("Hub keeps six primary destinations readable on desktop and mobile", async () => {
  const css = await readFile(new URL("../public/hub.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.dashboard-grid \{ display: grid; grid-template-columns: repeat\(6, 1fr\);/);
  assert.match(css, /\.projects-card \{ --accent: var\(--gold\); --soft: var\(--gold-soft\); \}/);
  assert.match(css, /\.finance-card \{ --accent: var\(--blue\); --soft: var\(--blue-soft\); \}/);
  assert.match(css, /\.writing-card \{ --accent: var\(--plum\); --soft: var\(--plum-soft\); \}/);
  assert.match(css, /\.topbar \{[\s\S]*position: relative;[\s\S]*z-index: 50;/);
  assert.match(css, /\.quick-add-menu \{ position: relative; z-index: 2; \}/);
  assert.match(css, /\.dashboard-grid \{ grid-template-columns: repeat\(3, 1fr\); gap: 5px; \}/);
  assert.match(css, /\.dashboard-card \{ min-height: 88px;/);
  assert.match(css, /\.metric-grid \{ grid-template-columns: 1fr 1fr;/);
  assert.match(css, /\.metric-grid \{ display: grid; grid-template-columns: repeat\(2, 1fr\);/);
  assert.match(css, /box-shadow: inset 0 3px 0 var\(--metric-accent\)/);
  assert.match(css, /\.review-shortcut \{ --metric-accent: var\(--violet\);/);
  assert.match(css, /\.habit-shortcut \{ --metric-accent: var\(--rust\);/);
  assert.match(css, /\.inbox-panel \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.inbox-list \{ grid-template-columns: repeat\(3, 1fr\); \}/);
  assert.doesNotMatch(css, /\.want-metric|\.wants-panel|\.want-list/);
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

test("Compass supports confirmation-safe bulk Inbox status changes", async () => {
  const [html, script, style] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="bulkModeButton"/);
  assert.match(html, /id="bulkToolbar"/);
  assert.match(html, /id="bulkSelectAll"/);
  assert.match(html, /id="bulkStatusSelect"/);
  assert.match(script, /class="item-card bulk-item-card/);
  assert.match(script, /window\.confirm\(`\$\{selected\.length\}件のInbox/);
  assert.match(script, /fetch\("\/api\/inbox-bulk"/);
  assert.match(script, /"X-Dashboard-Action": "inbox-bulk-update"/);
  assert.match(script, /変更できなかったInbox:/);
  assert.match(style, /\.bulk-toolbar/);
  assert.match(style, /\.bulk-item-card\.selected/);
});

test("Compass bulk-routes pending Inbox items to the triage destinations that need no per-item input", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  for (const [key, label] of [["wish", "欲しいもの"], ["writing", "執筆"], ["knowledge", "調査"], ["focus", "Focus"], ["github", "開発"], ["journal", "日記"], ["defer", "保留"]]) {
    assert.match(html, new RegExp(`<option value="route:${key}">${label}</option>`));
  }
  assert.doesNotMatch(html, /value="route:(calendar|habit)"/);
  assert.match(html, /<optgroup label="ステータスだけ変更">/);
  assert.match(html, /id="bulkRevisitOn" type="date"/);
  assert.match(script, /const BULK_ROUTE_KEYS = \["wish", "writing", "knowledge", "focus", "github", "journal", DEFER_ROUTE\];/);
  assert.match(script, /const pending = selected\.filter\(\(item\) => item\.status === "pending"\);/);
  assert.match(script, /revisitOn < todayInTokyo\(\)/);
  assert.match(script, /const cacheKey = `\$\{item\.id\}:\$\{key\}`;/);
  assert.match(script, /await markInboxTriaged\(item, `\$\{routeDestinationMeta\[quick\.destination\]\?\.label \|\| quick\.destination\}へ振り分け`\);/);
  assert.match(script, /振り分けできなかったInbox:/);
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

  assert.doesNotMatch(html, /id="completedWants"/);
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
  assert.match(script, /元のWantも完了します/);
  assert.match(script, /Google Calendarに登録して完了/);
  assert.match(script, /振り分けて完了/);
  assert.doesNotMatch(script, /元のWantは自動で完了にしません/);
});

test("Compass offers confirmation-safe quick routes for common Want destinations", async () => {
  const [script, style] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /writing:\s*\{[^}]*intent: "explore", destination: "writing"/);
  assert.match(script, /habit:\s*\{[^}]*intent: "continue", destination: "habit"/);
  assert.match(script, /archive:\s*\{[^}]*intent: "discard", destination: "archive"/);
  assert.match(script, /data-quick-route=/);
  assert.match(script, /function startQuickWantRoute\(item, key\)/);
  assert.match(script, /renderRouteForm\(item, quick\.intent, quick\.destination, \{\}, "quick"\)/);
  assert.match(script, /origin === "quick"[\s\S]*renderDrawerItem\(item, state\.triageSource\)/);
  assert.match(script, /function renderRoutePreview\(item, plan\)/);
  assert.match(style, /\.quick-route-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
});

test("Idea keeps Google Calendar reconnection available from the main screen", async () => {
  const html = await readFile(new URL("../public/compass/index.html", import.meta.url), "utf8");

  assert.match(html, /class="dashboard-secondary"/);
  assert.match(html, /href="\/api\/google-calendar-connect"/);
  assert.match(html, />Calendar再接続<\/a>/);
});

test("Compass asks AI only on explicit action and sends suggestions through human review", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="askAiTriageButton"/);
  assert.match(script, /askAiTriageButton"\)\.addEventListener\("click", \(\) => requestAiTriage\(item\)\)/);
  assert.match(script, /押した時だけ、本文をClaude APIへ送信/);
  assert.match(script, /fetch\("\/api\/want-suggestions"/);
  assert.match(script, /X-Dashboard-Action": "want-ai-suggest"/);
  assert.match(script, /source: sourceView === "inbox" \? "inbox" : "want"/);
  assert.match(script, /sourceId: item\.id/);
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

test("Compass exposes all nine first-class Inbox outcomes without hiding the detailed triage menu", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /id="triageInboxButton"/);
  assert.match(script, /data-inbox-route="\$\{key\}"/);
  assert.match(script, /calendar: \{ label: "予定"[^}]*destination: "calendar" \}/);
  assert.match(script, /wish: \{ label: "欲しいもの"/);
  assert.match(script, /writing: \{ label: "執筆"[^}]*destination: "writing" \}/);
  assert.match(script, /knowledge: \{ label: "調査"[^}]*destination: "knowledge" \}/);
  assert.match(script, /habit: \{ label: "習慣"[^}]*destination: "habit" \}/);
  assert.match(script, /focus: \{ label: "Focus"[\s\S]*destination: "focus" \}/);
  assert.match(script, /github: \{ label: "開発"[^}]*destination: "github" \}/);
  assert.match(script, /journal: \{ label: "日記"[^}]*destination: "journal" \}/);
  assert.match(script, /defer: \{ label: "保留"/);
  assert.match(script, /function renderTriageStart\(item\)/);
  assert.match(script, /async function createWantFromSource\(sourceItem, extra = \{\}\)/);
  assert.match(script, /async function markInboxTriaged\(sourceItem, result\)/);
  assert.match(script, /"X-Dashboard-Action": "inbox-update"/);
  assert.match(script, /へ振り分け`\)/);
  assert.doesNotMatch(script, /createWantButton|markInboxPromoted|Wantsに登録/);
  assert.doesNotMatch(script, /action-create|action-update|createActionButton|editActionButton/);
});

test("Compass stores 欲しい as a typed active Want", async () => {
  const [script, style] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function renderWishForm\(sourceItem\)/);
  assert.match(script, /\{ type: "wish", note: note \|\| null \}/);
  assert.match(script, /欲しいものとしてWantsに保存/);
  assert.match(script, /item\.type !== "wish"/);
  assert.match(style, /\.route-chip-wish \{[^}]*var\(--blue\)/);
});

test("Compass exposes Wants registration queues for Knowledge and GitHub", async () => {
  const [script, html, style] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function triageChips\(item, view\)/);
  assert.match(script, /route-chip route-chip-pending">Knowledge登録待ち/);
  assert.match(script, /function isDestinationPending\(item, view, destination\)/);
  assert.match(script, /state\.metricFilter === "knowledge"/);
  assert.match(script, /state\.metricFilter === "github"/);
  assert.match(script, /sourceInboxId: sourceItem\.id/);
  assert.match(html, /id="knowledgeFilter"/);
  assert.match(html, /id="knowledgePendingCount"/);
  assert.match(html, /id="githubFilter"/);
  assert.match(html, /id="githubPendingCount"/);
  assert.match(style, /\.route-chip-pending \{[^}]*var\(--orange\)/);
});

test("Compass defers an Inbox item with a required revisit date", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /function renderDeferForm\(sourceItem\)/);
  assert.match(script, /id="deferRevisitOn" name="revisitOn" type="date"/);
  assert.match(script, /function defaultRevisitDate\(\)/);
  assert.match(script, /既定は1ヶ月後です。/);
  assert.match(script, /再訪日は今日以降の日付を指定してください。/);
  assert.match(script, /createWantFromSource\(\{ \.\.\.sourceItem, content \}, \{ revisitOn, note: note \|\| null \}\)/);
  assert.match(script, /保留（再訪 \$\{revisitOn\}）/);
});

test("Idea starts with utility actions and the workspace, without summary cards or a decorative hero", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /class="hero"|PERSONAL DIRECTION|頭の中を、|hero-date|dayLabel|dateLabel|updatedLabel/);
  assert.doesNotMatch(script, /setClock|dayLabel|dateLabel|updatedLabel/);
  assert.match(html, /<main class="dashboard-main">/);
  assert.doesNotMatch(html, /<section class="metrics"|未整理のInbox|未整理のWants|未実施のToDo|整理済みのWants/);
  assert.doesNotMatch(script, /pendingInbox|inboxTotal|activeWants|completedWants|pendingTodos|querySelectorAll\("\.metric"\)/);
});

test("Idea updates the ToDo tab count as soon as background loading finishes", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /async function loadTodos[\s\S]*state\.todosLoaded = true;[\s\S]*els\.todosTabCount\.textContent = state\.data\.todosSummary\.pending;[\s\S]*if \(state\.view === "todos"\)/);
});

test("Hub and personal dashboards use the requested page names and shared shell", async () => {
  const [hub, idea, writing, habits, shell] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/writing/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/habits/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard-shell.css", import.meta.url), "utf8"),
  ]);

  assert.match(hub, /<h2>Idea<\/h2>/);
  assert.match(hub, /<h2>Finance<\/h2>/);
  assert.match(hub, /<h2>Knowledge<\/h2>/);
  assert.match(idea, /<h1>Idea<\/h1>/);
  assert.match(hub, /class="idea-mark-icon"/);
  assert.match(idea, /class="idea-mark-icon"/);
  assert.doesNotMatch(hub, /class="card-icon"[^>]*>↗<\/span>/);
  assert.doesNotMatch(idea, /class="dashboard-brand-mark idea"[^>]*>↗<\/span>/);
  assert.match(writing, /<h1>Writing<\/h1>/);
  assert.match(habits, /<h1>Habits<\/h1>/);
  assert.match(idea, /dashboard-shell\.css/);
  assert.match(writing, /dashboard-shell\.css/);
  assert.match(habits, /dashboard-shell\.css/);
  for (const page of [idea, writing, habits]) {
    assert.match(page, /<summary aria-label="ページを切り替える">/);
    assert.match(page, /class="dashboard-switcher-icon"/);
  }
  assert.doesNotMatch(shell, /content:\s*"▦"/);
  assert.match(shell, /\.dashboard-switcher-icon/);
  assert.match(shell, /\.dashboard-switcher summary \{ width: 40px; height: 40px; min-height: 40px;/);
  assert.match(shell, /\.dashboard-hub, \.dashboard-switcher summary, \.dashboard-refresh, \.dashboard-primary \{ height: 40px; min-height: 40px; \}/);
  assert.match(shell, /--dashboard-width: 1240px/);
  assert.match(shell, /--dashboard-header-height: 68px/);
});

test("Compass defaults each tab to actionable items and counts the filtered results", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /status: "pending"/);
  assert.match(script, /inbox: "pending",\s+wants: "active",/);
  assert.match(script, /function setView\(view, filter = defaultStatusByView\[view\], sync = true\)/);
  assert.match(script, /function renderCurrentTabCount\(items\)/);
  assert.match(script, /countElement\.textContent = items\.length/);
});

test("Idea exposes a Calendar-backed ToDo tab with completion and rescheduling", async () => {
  const [script, html, style] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-view="todos">ToDo/);
  assert.match(html, /id="todosTabCount"/);
  assert.match(html, /data-todo-filter="overdue">実施確認待ち/);
  assert.match(html, /data-todo-filter="today">今日/);
  assert.match(html, /data-todo-filter="upcoming">今後/);
  assert.match(script, /"\/api\/scheduled-actions"/);
  assert.match(script, /完了にする/);
  assert.match(script, /日程を決め直す/);
  assert.match(script, /新しい予定として再作成/);
  assert.match(script, /同じGoogle Calendar予定の日時だけを更新します。新しい予定は作成しません。/);
  assert.match(script, /"If-Match"|calendarEtag/);
  assert.match(style, /\.todo-timing-overdue/);
  assert.match(style, /\.todo-notice\.attention/);
});

test("Compass applies direct record routes and safe fallbacks", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(script, /parseCompassRoute\(window\.location\.href\)/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /openDrawer\(route\.id, route\.view, "none"\)/);
  assert.match(script, /完了またはアーカイブ済みです。一覧を表示します/);
  assert.match(script, /が見つかりません。一覧を表示します/);
});
