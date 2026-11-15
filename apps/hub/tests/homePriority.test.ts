import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HOME_SECTIONS } from "../functions/_shared/homeSettings.ts";
import { HUB_SOURCE_SECTIONS, loadHub, skippedHubSources } from "../functions/_shared/hub.ts";
import { onRequest as hubRequest } from "../functions/api/hub.ts";
import { hubUrl, parseHidden, revealedSections, sameSections } from "../public/home-sections.js";
import { HOME_SKIP_RESULT, inboxMetaLabel, restoreRequest, skipRequest, withAdded, withRemoved } from "../public/home-inbox.js";
import type { HomeInboxState } from "../public/home-inbox.d.ts";
import { hubReadFixture } from "./readModelFixtures.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const env = {
  SUPABASE_URL: "https://compass.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
  HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
  NAV_KNOWLEDGE_URL: "https://knowledge-50b.pages.dev/",
  NAV_FINANCIAL_URL: "https://finance-9qq.pages.dev/",
};
const now = new Date("2026-11-10T03:00:00Z");

// ---------- #329 日付が変わったとき ----------

test("#329: a new JST day refreshes the date label and Today together with the Hub", async () => {
  const script = await read("../public/hub.js");
  const refresh = script.slice(script.indexOf("function refreshJstDay"), script.indexOf("document.addEventListener('visibilitychange'"));
  assert.match(refresh, /setClock\(\);/);
  assert.match(refresh, /loadHome\(\);/);
  // loadHome は表示中なら Today も読む。
  assert.match(script, /function loadHome\(revealed = null\) \{\s+if \(!hiddenSections\.includes\("today"\) && \(!revealed \|\| revealed\.includes\("today"\)\)\) void today\.load\(\);/);
  // 日付ラベルは端末の時刻帯ではなく日本時間。
  assert.match(script, /function setClock\(\) \{[^}]*timeZone: "Asia\/Tokyo"/s);
});

// ---------- #330 スマホ幅の件数と内訳 ----------

test("#330: phone width keeps the counts, and queue details are not tooltip-only", async () => {
  const [css, html, script] = await Promise.all([read("../public/hub.css"), read("../public/index.html"), read("../public/hub.js")]);
  assert.doesNotMatch(css, /\.app-row \{ display: none; \}/);
  const phone = css.slice(css.indexOf("ここは件数を読む欄にする"));
  assert.match(phone.slice(0, phone.indexOf("}\n}")), /\.app-icon \{ display: none; \}/);
  // 3列になる幅では件数を戻す。
  const tablet = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (max-width: 620px)"));
  assert.match(tablet, /\.app-pill small \{ display: block; \}/);
  assert.match(html, /id="knowledgeQueueMeta" hidden/);
  assert.match(script, /採点待ち \$\{summary\.reviewWaitingGrading\}件/);
  assert.match(script, /採点エラーが\$\{summary\.reviewGradingErrors\}件あります/);
  assert.match(script, /問題を作れず保留になったナレッジが\$\{summary\.reviewGenerationHeld\}件あります/);
});

test("#330: the Inbox heading shows untriaged Wants next to the Inbox count", () => {
  assert.equal(inboxMetaLabel(3, 2), "未整理 3件 · Wants 2件");
  assert.equal(inboxMetaLabel(3, 0), "未整理 3件");
  assert.equal(inboxMetaLabel(0, 1), "未整理のInboxなし · Wants 1件");
  assert.equal(inboxMetaLabel(0, null), "未整理のInboxなし");
  assert.equal(inboxMetaLabel(null, 4), "Inboxを取得できません");
});

// ---------- #331 ホームからのInbox追加・見送り ----------

test("#331: Home adds to the Inbox in place with the existing guarded API", async () => {
  const [html, script] = await Promise.all([read("../public/index.html"), read("../public/hub.js")]);
  assert.match(html, /<form class="inbox-quick" id="inboxQuickForm">/);
  assert.match(html, /id="inboxQuickInput" name="content" maxlength="2000" required/);
  assert.match(html, /id="inboxQuickError" role="alert" hidden/);
  assert.ok(html.indexOf('id="inboxQuickForm"') < html.indexOf('id="inboxList"'));
  assert.match(script, /inboxApi\("POST", "inbox-create", \{ content \}\)/);
  assert.match(script, /inboxApi\("PATCH", "inbox-update", skipRequest\(item\)\)/);
  assert.match(script, /inboxApi\("PATCH", "inbox-update", restoreRequest\(item\)\)/);
  // 失敗したときは入力を消さない（成功した分岐でだけ空にする）。
  const add = script.slice(script.indexOf("async function addInbox"), script.indexOf("async function skipInbox"));
  assert.ok(add.indexOf('els.inboxQuickInput.value = ""') < add.indexOf("} catch"));
  assert.doesNotMatch(add.slice(add.indexOf("} catch")), /inboxQuickInput\.value = ""/);
});

test("#331: skipping is conflict-checked and its undo restores the previous values", () => {
  const item = { id: 7, content: "読む本を決める", status: "pending", result: null };
  assert.deepEqual(skipRequest(item), {
    id: 7, content: "読む本を決める", status: "skipped", result: HOME_SKIP_RESULT,
    original: { content: "読む本を決める", status: "pending", result: null },
  });
  assert.deepEqual(restoreRequest(item), {
    id: 7, content: "読む本を決める", status: "pending", result: null,
    original: { content: "読む本を決める", status: "skipped", result: HOME_SKIP_RESULT },
  });
});

test("#331: local Inbox state keeps the oldest-three preview and never goes negative", () => {
  const row = (id: number) => ({ id, content: `item ${id}`, created_at: "2026-11-10T00:00:00Z" });
  let state: HomeInboxState = { pending: 0, items: [] };
  for (const id of [1, 2, 3, 4]) state = withAdded(state, row(id));
  assert.equal(state.pending, 4);
  assert.deepEqual(state.items.map((item) => item.id), [1, 2, 3]);
  assert.equal(state.items[0].url, "/compass/?view=inbox&id=1");
  state = withRemoved(state, 2);
  assert.equal(state.pending, 3);
  assert.deepEqual(state.items.map((item) => item.id), [1, 3]);
  assert.equal(withRemoved({ pending: 0, items: [] }, 9).pending, 0);
});

// ---------- #335 表示設定 ----------

test("#335: section keys have one server definition, mirrored by the page and its CSS", async () => {
  const [html, css, script] = await Promise.all([read("../public/index.html"), read("../public/hub.css"), read("../public/hub.js")]);
  const inPage = [...new Set([...html.matchAll(/data-home-section="([a-z]+)"(?: data-fold="\1")? data-home-label="[^"]+"/g)].map((match) => match[1]))];
  // 並びはページの見た目が決める。欄の集合がサーバーの定義と一致していればよい。
  assert.deepEqual([...inPage].sort(), [...HOME_SECTIONS].sort());
  assert.equal([...html.matchAll(/data-home-section="/g)].length, inPage.length);
  for (const key of HOME_SECTIONS) {
    assert.ok(css.includes(`html[data-home-hidden~="${key}"] [data-home-section="${key}"]`), key);
  }
  // 画面側に欄の一覧を二重に持たない。
  assert.doesNotMatch(script, /const HOME_SECTIONS/);
  for (const sections of Object.values(HUB_SOURCE_SECTIONS)) {
    for (const section of sections) assert.ok((HOME_SECTIONS as readonly string[]).includes(section));
  }
});

test("#335: saved sections apply before first paint and nothing shows until settings are known", async () => {
  const [html, css, boot] = await Promise.all([read("../public/index.html"), read("../public/hub.css"), read("../public/static/home-boot.js")]);
  assert.ok(html.indexOf('<script src="/home-boot.js"></script>') < html.indexOf('<link rel="stylesheet"'));
  assert.match(css, /html:not\(\[data-home-ready\]\) \[data-home-section\] \{ display: none !important; \}/);
  assert.match(boot, /localStorage\.getItem\("hub-home-hidden"\)/);
  // 端末に置くのは欄の名前だけ。
  assert.doesNotMatch(boot, /fetch\(|setItem/);
});

test("#335: client helpers build the request and detect newly shown sections", () => {
  assert.equal(hubUrl([]), "/api/hub");
  assert.equal(hubUrl(["journal", "expenses"]), "/api/hub?hidden=journal,expenses");
  assert.deepEqual(parseHidden("journal data"), ["journal", "data"]);
  assert.deepEqual(parseHidden(undefined), []);
  assert.deepEqual(revealedSections(["journal", "data"], ["data"]), ["journal"]);
  assert.deepEqual(revealedSections([], ["data"]), []);
  assert.equal(sameSections(["a", "b"], ["b", "a"]), true);
  assert.equal(sameSections(["a"], ["a", "b"]), false);
});

test("#335: a source is skipped only when every section that uses it is hidden", () => {
  assert.deepEqual(skippedHubSources([]), []);
  assert.deepEqual(skippedHubSources(["journal"]), ["journal", "journalTrend"]);
  // 家計簿はアプリ一覧の件数にも使うので、片方だけでは読み続ける。
  assert.deepEqual(skippedHubSources(["expenses"]), []);
  assert.deepEqual(skippedHubSources(["apps", "expenses"]), ["writing", "expenses", "habits"]);
});

test("#335: hidden sections are not fetched, are not reported as failures, and alerts still load", async (t) => {
  const requests: Array<{ path: string; host: string; source?: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, host: url.hostname, source: init?.body ? JSON.parse(String(init.body)).p_source : undefined });
    return hubReadFixture(input, init);
  });
  const hub = await loadHub(env, now, { hidden: ["apps", "expenses", "journal"] });
  assert.equal(requests.some((request) => request.path.endsWith("/daily_journal")), false);
  assert.equal(requests.some((request) => request.host.includes("finance")), false);
  assert.equal(requests.some((request) => request.source === "habits" || request.source === "writing"), false);
  assert.ok(requests.some((request) => request.source === "inbox"));
  assert.ok(requests.some((request) => request.path === "/api/status"));
  assert.equal(hub.source.state, "live");
  assert.deepEqual(hub.source.unavailable, []);
  assert.deepEqual((hub.source as { skipped?: string[] }).skipped, ["writing", "expenses", "journal", "journalTrend", "habits"]);
  assert.equal(hub.summary.currentMonthSpend, null);

  requests.length = 0;
  const all = await loadHub(env, now);
  assert.ok(requests.some((request) => request.path.endsWith("/daily_journal")));
  assert.equal("skipped" in all.source, false);
});

test("#335: the API reads ?hidden= and ignores unknown names", async (t) => {
  const sources: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) sources.push(JSON.parse(String(init.body)).p_source);
    return hubReadFixture(input, init);
  });
  const response = await hubRequest({ request: new Request("https://hub.example/api/hub?hidden=focus,bogus"), env });
  assert.equal(response.status, 200);
  assert.equal(sources.includes("focus"), false);
  assert.ok(sources.includes("inbox"));
  assert.deepEqual((await response.json()).source.skipped, ["focus"]);
});
