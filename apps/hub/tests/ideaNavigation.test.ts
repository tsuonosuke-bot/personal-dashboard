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
