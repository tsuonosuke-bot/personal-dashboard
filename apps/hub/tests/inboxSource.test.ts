import assert from "node:assert/strict";
import test from "node:test";
import { splitInboxSource } from "../public/compass/inbox-source.js";

test("行動と登録時の引用を残し、示唆・日記のIDだけで出典リンクを作る", () => {
  for (const [type, id] of [["insight", "42"], ["journal", "2026-10-22"]]) {
    const body = "明日の会議前に基準を書く\n\n元の示唆: 先に基準を決める";
    const result = splitInboxSource(`${body}\n\n行動元: 題名 <script>（${type} ${id}）`);
    assert.equal(result.body, body);
    assert.equal(result.source?.prefix, "行動元");
    assert.equal(result.source?.label, "題名 <script>");
    assert.equal(result.source?.url, `/knowledge/?view=action-source&sourceType=${type}&sourceId=${id}`);
  }
});

test("不正な日付・ID・任意のURLを出典リンクにしない", () => {
  for (const marker of ["journal 2026-02-30", "insight 0", "insight 9007199254740992", "insight https://evil.example", "journal 2026-10-22&evil=1"]) {
    const content = `行動\n\n行動元: 出典（${marker}）`;
    assert.deepEqual(splitInboxSource(content), { body: content, source: null });
  }
});

test("既存の復習から深掘りしたInboxの出典リンクを保つ", () => {
  const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
  const result = splitInboxSource(`理由を調べる\n\n深掘り元: 復習「用法」（knowledge ${knowledgeId}）`);
  assert.equal(result.body, "理由を調べる");
  assert.equal(result.source?.knowledgeId, knowledgeId);
  assert.equal(result.source?.url, `/knowledge/?knowledge=${knowledgeId}`);
});
