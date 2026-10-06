import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readCompassScript } from "./compassScript.ts";

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
  // 復習と習慣の数字カードは「今日やること」とKnowledgeの件数表示に置き換えた
  assert.doesNotMatch(html, /id="reviewMetricLink"|id="habitMetricLink"|class="metric-grid"/);
  assert.doesNotMatch(html, /id="reviewStartLink"|id="spendMetricLink"|id="currentMonthSpend"|id="pendingInbox"|id="untriagedMetricLink"|id="untriagedWants"|id="oldestUntriaged"/);
  assert.match(html, /id="writingLink"/);
  assert.match(html, /class="app-pill writing-pill" id="writingLink"/);
  assert.match(html, /id="projectsMeta">—/);
  assert.match(html, /id="writingMeta">—/);
  assert.doesNotMatch(html, /目標をNext Actionへ|Pomeraで書くテーマ/);
  assert.ok(html.indexOf('id="hubContent"') < html.indexOf('class="data-tools"'));
  // 「今日やること」はアプリ一覧のすぐ下、既存の一覧より前に置く
  assert.ok(html.indexOf('class="app-row"') < html.indexOf('id="todayPanel"'));
  assert.ok(html.indexOf('id="todayPanel"') < html.indexOf('id="hubContent"'));
  for (const id of ["todayDoneCounter", "todayAllDone", "todayTodos", "todayHabits", "todayProjects", "todaySheet", "todayToast"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="inboxList"/);
  assert.match(html, /未整理のInbox/);
  assert.match(html, /id="focusList"/);
  assert.match(html, /id="manageFocusButton"/);
  assert.match(html, /id="focusModal"/);
  assert.match(html, /id="allInboxLink"/);
  assert.match(html, /id="journalList"/);
  assert.match(html, /id="journalTrend"/);
  assert.match(html, /過去のJournal/);
  assert.match(html, /読み取り専用/);
  assert.match(script, /renderInbox\(payload\.inbox \|\| \[\], availability\.inbox\)/);
  assert.match(script, /labeledCount\("進行中", summary\.activeProjects\)/);
  assert.match(script, /labeledCount\("アイデア", summary\.writingIdeas\)/);
  assert.match(script, /Inboxを取得できませんでした/);
  assert.match(script, /els\.inboxMeta\.textContent = "未整理のInboxなし"/);
  assert.match(script, /els\.inboxList\.innerHTML = "";/);
  assert.match(script, /class="inbox-state">未整理/);
  assert.match(script, /escapeHtml\(item\.url \|\| "\/compass\/\?view=inbox"\)/);
  assert.match(script, /renderFocus\(payload\.focus \|\| \[\], availability\.focus\)/);
  // Knowledgeは問題キューのすぐ解ける問題数を出し、あればそのまま復習を始める。
  assert.match(script, /els\.knowledgeLink\.href = readyDue > 0 \? navigation\.knowledgeReview : navigation\.knowledge/);
  assert.match(script, /readyDue > 0 \? `復習 \$\{readyDue\}問` : "復習なし"/);
  assert.match(script, /`採点待ち \$\{formatCount\(summary\.reviewWaitingGrading\)\}`/);
  assert.match(script, /`未確認 \$\{formatCount\(summary\.reviewUnconfirmed\)\}`/);
  assert.match(script, /`すぐ解ける \$\{readyDue\}問`/);
  assert.match(script, /import \{ createTodayPanel \} from "\.\/today-panel\.js"/);
  assert.match(script, /today\.setNavigation\(payload\.navigation\)/);
  assert.doesNotMatch(script, /completedKnowledgeToday|todayKnowledgeTotal|overdueKnowledge|remainingKnowledgeToday/);
  assert.match(script, /fetch\("\/api\/focus"/);
  assert.match(script, /"X-Dashboard-Action": action/);
  assert.match(script, /focus-update/);
  assert.match(script, /focus-reorder/);
  assert.match(script, /表示から外す/);
  assert.match(script, /renderJournal\(payload\.journalMoments, availability\.journal\)/);
  assert.match(script, /renderJournalTrend\(payload\.journalTrend, availability\.journalTrend !== false\)/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(script, /reviewStartLink|spendMetricLink|spendComparison|els\.currentMonthSpend|els\.pendingInbox|untriagedMetricLink|oldestUntriaged|renderWants/);
  assert.match(script, /一部取得不可/);
  assert.match(script, /renderExpenses\(payload\.recentExpenses, availability\.expenses\)/);
  assert.doesNotMatch(`${html}\n${script}`, /再訪日|再訪期限/);
});

test("Hub keeps six destinations in one compact row and readable text on mobile", async () => {
  const css = await readFile(new URL("../public/hub.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.app-row \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.app-row \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.projects-pill \{ --accent: var\(--project\); --soft: var\(--project-soft\); \}/);
  assert.match(css, /\.finance-pill \{ --accent: var\(--blue\); --soft: var\(--blue-soft\); \}/);
  assert.match(css, /\.writing-pill \{ --accent: var\(--plum\); --soft: var\(--plum-soft\); \}/);
  assert.match(css, /\.habits-pill \{ --accent: var\(--habit\); --soft: var\(--habit-soft\); \}/);
  // 件数が長くてもアプリ名は省略しない（件数側だけを…で切る）
  assert.match(css, /\.app-pill b \{ flex: none;/);
  assert.match(css, /\.app-pill small \{ min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(css, /\.quick-add-menu \{ position: relative; z-index: 2; \}/);
  assert.doesNotMatch(css, /\.dashboard-grid|\.dashboard-card|\.metric-grid|\.review-shortcut|\.habit-shortcut/);
  assert.match(css, /\.inbox-panel \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.inbox-list \{ grid-template-columns: repeat\(3, 1fr\); \}/);
  assert.doesNotMatch(css, /\.want-metric|\.wants-panel|\.want-list/);
  assert.match(css, /\.journal-list \{ grid-template-columns: 1fr; \}/);
});

test("Today panel follows the other pages' controls with 44px targets and 11px+ text", async () => {
  const css = await readFile(new URL("../public/hub.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((line) => /^\s*\.(today-|app-)/.test(line));
  assert.ok(rules.length > 40);
  for (const rule of rules) {
    for (const [, size] of rule.matchAll(/font-size: (\d+)px/g)) {
      assert.ok(Number(size) >= 11, `${rule.trim()} uses ${size}px`);
    }
  }
  // 完了の丸はHabitsページ（.check-button）と同じ線色・塗りで、押せる範囲は44px
  assert.match(css, /--check-line: #c4b5ab;/);
  assert.match(css, /\.today-check \{[^}]*width: 44px; height: 44px;/);
  assert.match(css, /\.today-check\.is-on \.today-check-mark \{ border-color: var\(--check\); background: var\(--check\); color: #fff; \}/);
  // 期限切れはIdea、次の一手と注意はProjectsと同じ色
  assert.match(css, /--overdue: #a54428;/);
  assert.match(css, /--overdue-soft: #fff0e9;/);
  assert.match(css, /--attention: #9a493c;/);
  assert.match(css, /\.today-next-action \{[^}]*border-left: 3px solid var\(--project\);[^}]*background: var\(--project-soft\);/);
  // スマホでは見直しを下から出し、トーストは画面幅いっぱいにする
  assert.match(css, /\.today-sheet \{ place-items: end stretch; padding: 0; \}/);
  assert.match(css, /\.today-toast \{ right: 12px; left: 12px; bottom: calc\(12px \+ var\(--tabbar-space, 0px\)\);/);
});

test("Compass exposes a real Inbox create menu", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readCompassScript(),
  ]);

  assert.match(html, /id="addInboxButton"/);
  assert.match(html, /id="inboxForm"/);
  assert.match(html, /maxlength="2000"/);
  assert.match(script, /fetch\("\/api\/inbox"/);
  assert.match(script, /X-Dashboard-Action.*inbox-create/s);
});

test("Compass edits an Inbox and reloads the canonical data", async () => {
  const script = await readCompassScript();

  assert.match(script, /id="editInboxButton"/);
  assert.match(script, /method: "PATCH"/);
  assert.match(script, /X-Dashboard-Action": "inbox-update"/);
  assert.match(script, /const refreshed = await loadDashboard\(\)/);
});

test("Compass supports confirmation-safe bulk Inbox status changes", async () => {
  const [html, script, style] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readCompassScript(),
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
    readCompassScript(),
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
  assert.match(script, /await routeInboxViaApi\(item\.id, quick\.destination, \{/);
  assert.match(script, /振り分けできなかったInbox:/);
});

test("Compass edits Wants through a dedicated API", async () => {
  const script = await readCompassScript();

  assert.match(script, /id="editWantButton"/);
  assert.match(script, /endpoint: "\/api\/wants"/);
  assert.match(script, /actionHeader: "want-update"/);
});

test("Compass previews every route and requires explicit confirmation for Google Calendar", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readCompassScript(),
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
    readCompassScript(),
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
  const script = await readCompassScript();

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
  const script = await readCompassScript();

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
  const script = await readCompassScript();

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
  // 振り分けの書き込みはすべてDB関数（inbox-route-v1）経由。画面側でWant作成とInbox更新を分けて呼ばない。
  assert.match(script, /async function routeInboxViaApi\(inboxId, exit, params, idempotencyKey\)/);
  assert.match(script, /"X-Dashboard-Action": "inbox-route"/);
  assert.doesNotMatch(script, /createWantFromSource|markInboxTriaged/);
  assert.doesNotMatch(script, /createWantButton|markInboxPromoted|Wantsに登録/);
  assert.doesNotMatch(script, /action-create|action-update|createActionButton|editActionButton/);
});

test("Compass stores 欲しい as a typed active Want", async () => {
  const [script, style] = await Promise.all([
    readCompassScript(),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function renderWishForm\(sourceItem\)/);
  assert.match(script, /routeInboxViaApi\(sourceItem\.id, "wish", \{/);
  assert.match(script, /欲しいものとしてWantsに保存/);
  assert.match(script, /item\.type !== "wish"/);
  assert.match(style, /\.route-chip-wish \{[^}]*var\(--blue\)/);
});

test("Compass exposes Wants registration queues for Knowledge and GitHub", async () => {
  const [script, html, style] = await Promise.all([
    readCompassScript(),
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function triageChips\(item, view\)/);
  assert.match(script, /route-chip route-chip-pending">Knowledge登録待ち/);
  assert.match(script, /function isDestinationPending\(item, view, destination\)/);
  assert.match(script, /state\.metricFilter === "knowledge"/);
  assert.match(script, /state\.metricFilter === "github"/);
  assert.match(script, /body: JSON\.stringify\(\{ inboxId, exit, params, idempotencyKey \}\)/);
  assert.match(html, /id="knowledgeFilter"/);
  assert.match(html, /id="knowledgePendingCount"/);
  assert.match(html, /id="githubFilter"/);
  assert.match(html, /id="githubPendingCount"/);
  assert.match(style, /\.route-chip-pending \{[^}]*var\(--orange\)/);
});

test("Compass defers an Inbox item with a required revisit date", async () => {
  const script = await readCompassScript();

  assert.match(script, /function renderDeferForm\(sourceItem\)/);
  assert.match(script, /id="deferRevisitOn" name="revisitOn" type="date"/);
  assert.match(script, /function defaultRevisitDate\(\)/);
  assert.match(script, /既定は1ヶ月後です。/);
  assert.match(script, /再訪日は今日以降の日付を指定してください。/);
  assert.match(script, /routeInboxViaApi\(sourceItem\.id, "defer", \{[\s\S]*revisit_on: revisitOn,/);
  assert.match(script, /保留（再訪 \$\{revisitOn\}）/);
});

test("Idea starts with utility actions and the workspace, without summary cards or a decorative hero", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/compass/index.html", import.meta.url), "utf8"),
    readCompassScript(),
  ]);

  assert.doesNotMatch(html, /class="hero"|PERSONAL DIRECTION|頭の中を、|hero-date|dayLabel|dateLabel|updatedLabel/);
  assert.doesNotMatch(script, /setClock|dayLabel|dateLabel|updatedLabel/);
  assert.match(html, /<main class="dashboard-main">/);
  assert.doesNotMatch(html, /<section class="metrics"|未整理のInbox|未整理のWants|未実施のToDo|整理済みのWants/);
  assert.doesNotMatch(script, /pendingInbox|inboxTotal|activeWants|completedWants|pendingTodos|querySelectorAll\("\.metric"\)/);
});

test("Idea updates the ToDo tab count as soon as background loading finishes", async () => {
  const script = await readCompassScript();

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

  assert.match(hub, /<b>Idea<\/b>/);
  assert.match(hub, /<b>Finance<\/b>/);
  assert.match(hub, /<b>Knowledge<\/b>/);
  assert.match(idea, /<h1>Idea<\/h1>/);
  assert.match(hub, /class="idea-mark-icon"/);
  assert.match(idea, /class="idea-mark-icon"/);
  assert.doesNotMatch(hub, /class="app-icon"[^>]*>↗<\/span>/);
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
  const script = await readCompassScript();

  assert.match(script, /status: "pending"/);
  assert.match(script, /inbox: "pending",\s+wants: "active",/);
  assert.match(script, /function setView\(view, filter = defaultStatusByView\[view\], sync = true\)/);
  assert.match(script, /function renderCurrentTabCount\(items\)/);
  assert.match(script, /countElement\.textContent = items\.length/);
});

test("Idea exposes a Calendar-backed ToDo tab with completion and rescheduling", async () => {
  const [script, html, style] = await Promise.all([
    readCompassScript(),
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
  const script = await readCompassScript();

  assert.match(script, /parseCompassRoute\(window\.location\.href\)/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /openDrawer\(route\.id, route\.view, "none"\)/);
  assert.match(script, /完了またはアーカイブ済みです。一覧を表示します/);
  assert.match(script, /が見つかりません。一覧を表示します/);
});

test("every Hub page shares one header, the same page switcher and the phone tab bar", async () => {
  const pages = {
    hub: "../public/index.html",
    idea: "../public/compass/index.html",
    projects: "../public/projects/index.html",
    habits: "../public/habits/index.html",
    writing: "../public/writing/index.html",
    status: "../public/status/index.html",
  };
  const links = ["Idea", "Projects", "Writing", "Habits", "Finance", "Knowledge", "接続状態"];
  for (const [page, path] of Object.entries(pages)) {
    const html = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(html, /<header class="dashboard-header">/, page);
    assert.match(html, /href="\/dashboard-shell\.css"/, page);
    assert.match(html, /href="\/dashboard-shell\.dark\.css"/, page);
    assert.match(html, new RegExp(`<script src="/tabbar\\.js" data-page="${page}" defer></script>`), page);
    assert.doesNotMatch(html, /class="topbar"|class="status-header"|id="dashboardNav"/, page);
    const nav = html.match(/<nav aria-label="ダッシュボードを切り替え">([\s\S]*?)<\/nav>/)?.[1] || "";
    assert.deepEqual([...nav.matchAll(/>([^<>]+)<\/(?:a|span)>/g)].map((match) => match[1]), links, page);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, page === "hub" ? 0 : 1, page);
  }
});

test("phone tab bar keeps Hub, Idea, Projects and Habits one tap away and lifts toasts above it", async () => {
  const [script, shell, habits, projects, compass, writing] = await Promise.all([
    readFile(new URL("../public/static/tabbar.js", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard-shell.css", import.meta.url), "utf8"),
    readFile(new URL("../public/habits.css", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.css", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/writing.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /\{ id: "hub", label: "ホーム", href: "\/"/);
  assert.match(script, /\{ id: "idea", label: "Idea", href: "\/compass\/"/);
  assert.match(script, /\{ id: "projects", label: "Projects", href: "\/projects\/"/);
  assert.match(script, /\{ id: "habits", label: "Habits", href: "\/habits\/"/);
  assert.match(script, /<span>その他<\/span>/);
  assert.match(script, /data-theme-select/);
  assert.match(shell, /\.tabbar \{ display: none; \}/);
  // viewport-fit=cover がないとiOSでsafe-areaが0になり、タブバーがホームインジケーターに重なる
  assert.match(shell, /:root \{ --tabbar-bottom: max\(10px, env\(safe-area-inset-bottom\)\); --tabbar-space: calc\(64px \+ var\(--tabbar-bottom\)\); \}/);
  for (const path of ["index.html", "compass/index.html", "projects/index.html", "habits/index.html", "writing/index.html", "status/index.html"]) {
    const page = await readFile(new URL(`../public/${path}`, import.meta.url), "utf8");
    assert.match(page, /name="viewport" content="[^"]*viewport-fit=cover"/, path);
  }
  assert.match(shell, /\.dashboard-hub, \.dashboard-actions \.dashboard-switcher \{ display: none; \}/);
  assert.match(shell, /min-height: 54px;/);
  for (const css of [habits, projects, compass, writing]) {
    assert.match(css, /\.toast \{ position: fixed;[^}]*bottom: calc\(1\dpx \+ var\(--tabbar-space, 0px\)\);/);
  }
});

test("Knowledge and Finance ship the same tab bar script and styles as the Hub", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const block = (css: string) => css.slice(css.indexOf("/* tabbar:start"), css.indexOf("/* tabbar:end */"));
  const [script, knowledgeScript, financeScript, shell, knowledgeCss, financeCss, knowledgeHtml, financeHtml, knowledgeApp, financeApp] = await Promise.all([
    read("../public/static/tabbar.js"),
    read("../../knowledge/public/tabbar.js"),
    read("../../finance/public/tabbar.js"),
    read("../public/dashboard-shell.css"),
    read("../../knowledge/src/index.css"),
    read("../../finance/src/index.css"),
    read("../../knowledge/index.html"),
    read("../../finance/index.html"),
    read("../../knowledge/src/App.tsx"),
    read("../../finance/src/App.tsx"),
  ]);
  assert.equal(knowledgeScript, script);
  assert.equal(financeScript, script);
  assert.ok(block(shell).length > 1000);
  assert.equal(block(knowledgeCss), block(shell));
  assert.equal(block(financeCss), block(shell));
  assert.match(knowledgeHtml, /<script src="\.\/tabbar\.js" data-page="knowledge" data-hub="https:\/\/personal-dashboard-7md\.pages\.dev" defer><\/script>/);
  assert.match(financeHtml, /<script src="\.\/tabbar\.js" data-page="finance" data-hub="https:\/\/personal-dashboard-7md\.pages\.dev" defer><\/script>/);
  for (const app of [knowledgeApp, financeApp]) {
    const nav = app.match(/<nav aria-label="ダッシュボードを切り替え">([\s\S]*?)<\/nav>/)?.[1] || "";
    assert.deepEqual([...nav.matchAll(/>([^<>{}]+)<\/(?:a|span)>/g)].map((match) => match[1]), ["Idea", "Projects", "Writing", "Habits", "Finance", "Knowledge", "接続状態"]);
  }
});
