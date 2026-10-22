import assert from "node:assert/strict";
import test from "node:test";
import { mergeSpeakingPrompts, missingSpeakingIds, speakingRetryTypes } from "../src/lib/speakingPreparation.ts";
import type { SpeakingPracticePrompt } from "../src/types.ts";

const item = (id: string): SpeakingPracticePrompt => ({ knowledge_id: id, practice_type: "instant_composition", prompt_ja: "確認をお願いします。", target_en: "Could you check this report?" });

test("不足分だけを補い、作成済みの例文と選択順を保持する", () => {
  const first = item("first");
  const selected = ["first", "second", "third"];
  const partial = mergeSpeakingPrompts(selected, [first], [item("third")]);
  assert.deepEqual(missingSpeakingIds(selected, partial), ["second"]);
  const complete = mergeSpeakingPrompts(selected, partial, [{ ...first, target_en: "Must not replace valid work." }, item("second")]);
  assert.deepEqual(complete.map((entry) => entry.knowledge_id), selected);
  assert.equal(complete[0], first);
  assert.deepEqual(missingSpeakingIds(selected, complete), []);
  assert.throws(() => mergeSpeakingPrompts(selected, partial, [item("outside")]), /対応できません/);
});

test("ミックスの不足分だけを再依頼しても、元の瞬間英作文・音読の割り当てを保つ", () => {
  assert.deepEqual(speakingRetryTypes(["a", "b", "c", "d"], ["b", "d"], "mixed"), { b: "read_aloud", d: "read_aloud" });
  assert.deepEqual(speakingRetryTypes(["a", "b", "c"], ["a", "c"], "mixed"), { a: "instant_composition", c: "instant_composition" });
  assert.deepEqual(speakingRetryTypes(["a", "b"], ["b"], "read_aloud"), { b: "read_aloud" });
});
