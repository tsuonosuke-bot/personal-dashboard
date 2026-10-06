import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WANT_CATEGORIES as WANT_UPDATE_CATEGORIES } from "../functions/_shared/itemUpdate.ts";
import { STORED_WANT_CATEGORIES, groupWantsByCategory, wantBacklogStage, wantCategory } from "../public/compass/want-category.js";
import { readCompassScript } from "./compassScript.ts";

test("Wants use the stored category, and wishes without one fall into 欲しい", () => {
  assert.equal(wantCategory({ type: "want", category: "place" }), "place");
  assert.equal(wantCategory({ type: "want", category: "watch" }), "watch");
  assert.equal(wantCategory({ type: "wish", category: "play" }), "play");
  assert.equal(wantCategory({ type: "wish", category: null }), "wish");
  assert.equal(wantCategory({ type: "want", category: null }), "other");
  assert.equal(wantCategory({ type: "want", category: "unknown" }), "other");
});

test("Backlog stages put due revisits first and sleeping Wants last within a category", () => {
  const today = "2026-10-06";
  assert.equal(wantBacklogStage({ revisitOn: null }, today), "ready");
  assert.equal(wantBacklogStage({ revisitOn: "2026-10-06" }, today), "due");
  assert.equal(wantBacklogStage({ revisitOn: "2026-12-31" }, today), "sleeping");

  const groups = groupWantsByCategory([
    { id: 1, type: "want", category: "play", revisitOn: "2026-12-31", createdAt: "2026-09-03" },
    { id: 2, type: "want", category: "play", revisitOn: null, createdAt: "2026-09-01" },
    { id: 3, type: "want", category: "play", revisitOn: "2026-09-30", createdAt: "2026-08-01" },
    { id: 4, type: "want", category: "place", revisitOn: null, createdAt: "2026-09-02" },
    { id: 5, type: "wish", category: null, revisitOn: null, createdAt: "2026-09-04" },
  ], today);
  assert.deepEqual(groups.map((group) => group.key), ["place", "play", "wish"]);
  assert.deepEqual(groups[1].items.map((item) => item.id), [3, 2, 1]);
});

test("Wants tab renders the backlog grouped by category with a category filter", async () => {
  const script = await readCompassScript();
  assert.match(script, /export function isWantsBacklog\(\)/);
  assert.match(script, /groupWantsByCategory\(items, today\)/);
  assert.match(script, /data-want-category=/);
  assert.match(script, /<span>次の一歩<\/span>/);
  assert.match(script, /id="wantCategorySelect"/);
  assert.match(script, /id="editItemCategory" name="category"/);
});

test("Wants category migration constrains values and backfills from Notion tags", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202610060002_wants_category.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists category text/);
  assert.match(sql, /category in \('place', 'watch', 'play', 'read', 'do', 'wish'\)/);
  assert.match(sql, /when note like '%［行きたい場所］%' then 'place'/);
  assert.deepEqual([...STORED_WANT_CATEGORIES].sort(), [...WANT_UPDATE_CATEGORIES].sort());
});
