import assert from "node:assert/strict";
import test from "node:test";
import { groupWantsByCategory, wantBacklogStage, wantCategory } from "../public/compass/want-category.js";
import { readCompassScript } from "./compassScript.ts";

const notion = (tag: string) => `Notion Inbox［${tag}］ https://www.notion.so/example`;

test("Wants are classified from the Notion source tag and the wish type", () => {
  assert.equal(wantCategory({ type: "want", note: notion("行きたい場所") }), "place");
  assert.equal(wantCategory({ type: "want", note: notion("見たい映画/アニメ") }), "watch");
  assert.equal(wantCategory({ type: "want", note: notion("プレイしたいゲーム") }), "play");
  assert.equal(wantCategory({ type: "want", note: notion("読みたい本") }), "read");
  assert.equal(wantCategory({ type: "want", note: notion("その他やりたいこと") }), "do");
  assert.equal(wantCategory({ type: "want", note: notion("欲しいもの") }), "wish");
  assert.equal(wantCategory({ type: "wish", note: null }), "wish");
  assert.equal(wantCategory({ type: "want", note: "今は動かさない" }), "other");
  assert.equal(wantCategory({ type: "want", note: notion("未知のタグ") }), "other");
});

test("Backlog stages put due revisits first and sleeping Wants last within a category", () => {
  const today = "2026-10-06";
  assert.equal(wantBacklogStage({ revisitOn: null }, today), "ready");
  assert.equal(wantBacklogStage({ revisitOn: "2026-10-06" }, today), "due");
  assert.equal(wantBacklogStage({ revisitOn: "2026-12-31" }, today), "sleeping");

  const groups = groupWantsByCategory([
    { id: 1, type: "want", note: notion("プレイしたいゲーム"), revisitOn: "2026-12-31", createdAt: "2026-09-03" },
    { id: 2, type: "want", note: notion("プレイしたいゲーム"), revisitOn: null, createdAt: "2026-09-01" },
    { id: 3, type: "want", note: notion("プレイしたいゲーム"), revisitOn: "2026-09-30", createdAt: "2026-08-01" },
    { id: 4, type: "want", note: notion("行きたい場所"), revisitOn: null, createdAt: "2026-09-02" },
    { id: 5, type: "wish", note: null, revisitOn: null, createdAt: "2026-09-04" },
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
});
