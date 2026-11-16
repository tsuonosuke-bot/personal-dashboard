import assert from "node:assert/strict";
import test from "node:test";
import { readCompassScript } from "./compassScript.ts";

test("opening a tab keeps its default status out of the filter, so 絞り込みを解除 stays hidden", async () => {
  const script = await readCompassScript();
  // 既定のステータス（active・pending）を metricFilter に入れない
  assert.match(script, /state\.metricFilter = COMPASS_FILTERS\.includes\(filter\) \? filter : "";/);
  assert.match(script, /const COMPASS_FILTERS = \["untriaged", "knowledge", "github", "overdue", "today", "upcoming"\];/);
  assert.doesNotMatch(script, /\n  state\.metricFilter = filter;\n/);
});

test("continuing the Inbox triage replaces the processed record in history instead of stacking it", async () => {
  const script = await readCompassScript();
  const flow = script.slice(script.indexOf("export async function continueInboxTriage"));
  // 積み増すと、閉じたときに整理済みの詳細へ戻って「完了またはアーカイブ済み」と出てしまう
  assert.doesNotMatch(flow, /openDrawer\(nextId, "inbox", "push"\)/);
  assert.match(flow, /openDrawer\(nextId, "inbox", "none"\);\n\s*window\.history\.replaceState\(window\.history\.state, "", compassRoutePath\(window\.location\.href, "inbox", nextId\)\);/);
});

test("adding an Inbox clears search and category so the new item is visible", async () => {
  const script = await readCompassScript();
  const create = script.slice(script.indexOf("export async function createInbox"));
  const reset = create.slice(0, create.indexOf("await loadDashboard();"));
  assert.match(reset, /state\.search = "";/);
  assert.match(reset, /state\.wantCategory = "";/);
  assert.match(reset, /els\.searchInput\.value = "";/);
});

test("the detail drawer sits above the sticky header so its close button stays visible", async () => {
  const { readFile } = await import("node:fs/promises");
  const [styles, shell] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard-shell.css", import.meta.url), "utf8"),
  ]);
  const z = (css: string, selector: RegExp) => Number(css.match(selector)?.[1]);
  const header = z(shell, /\.dashboard-header \{[^}]*?z-index: (\d+);/);
  const drawer = z(styles, /\n\.drawer \{[^}]*?z-index: (\d+);/);
  const backdrop = z(styles, /\n\.drawer-backdrop \{[^}]*?z-index: (\d+);/);
  assert.ok(backdrop > header && drawer > backdrop, `header ${header}, backdrop ${backdrop}, drawer ${drawer}`);
  // iPhoneのホーム画面アプリでは、×がステータスバーやホームインジケーターに重ならないよう安全領域をあける
  assert.match(styles, /\.drawer-close \{[^}]*top: calc\(19px \+ env\(safe-area-inset-top\)\)/);
});

test("Inbox shows 予定・調査・開発・日記 first and orders the rest by purpose", async () => {
  const { PRIMARY_INBOX_ROUTES, MORE_INBOX_ROUTES, inboxQuickRoutes } = await import(new URL("../public/compass/constants.js", import.meta.url).href);
  assert.deepEqual(PRIMARY_INBOX_ROUTES.map((key: string) => inboxQuickRoutes[key].label), ["予定", "調査", "開発", "日記"]);
  assert.deepEqual(MORE_INBOX_ROUTES.map((key: string) => inboxQuickRoutes[key].label), ["執筆", "問い", "習慣", "Focus", "欲しいもの", "SF6", "保留"]);
  // 両方を合わせると、すべての振り分け先が1回ずつ出る
  assert.deepEqual([...PRIMARY_INBOX_ROUTES, ...MORE_INBOX_ROUTES].sort(), Object.keys(inboxQuickRoutes).sort());
});

test("route forms fold the title and body fields so the confirm button is reachable at once", async () => {
  const script = await readCompassScript();
  assert.match(script, /export function textEditDisclosure\(label, fields, open = false\)/);
  assert.match(script, /textEditDisclosure\(`\$\{titleLabel\}・補足を直す`/);
  assert.equal(script.match(/textEditDisclosure\("内容・メモを直す"/g)?.length, 2);
  // 畳んだ欄に required を付けると、ブラウザの検証が隠れた欄で止まって送信できなくなる
  assert.doesNotMatch(script, /id="(routeTitle|wishContent|deferContent)"[^>]*required/);
  assert.match(script, /focusTextField\(form\.elements\.title\)/);
  assert.match(script, /else formSubmit\.focus\(\);/);
});
