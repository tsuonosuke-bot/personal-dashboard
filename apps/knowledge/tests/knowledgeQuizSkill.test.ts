import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("knowledge-quiz スキルはキューの v2 関数だけを使い、記録SQLをbase64で包む", async () => {
  const skill = await read("../skills/knowledge-quiz/SKILL.md");
  const script = await read("../skills/knowledge-quiz/scripts/validate_record.py");
  const migration = await read("../supabase/migrations/20261004100000_skill_review_queue.sql");

  assert.match(skill, /quiz-engine-v2/);
  assert.match(script, /CONTRACT = "quiz-engine-v2"/);
  assert.match(migration, /'contract_version', 'quiz-engine-v2'/);

  // スキルが呼ぶ direct_quiz_queue_* はすべてこのマイグレーションで作り、knowledge_quiz に実行権限を渡す
  const called = new Set([...skill.matchAll(/direct_quiz_queue_[a-z]+(?=\()/g)].map((match) => match[0]));
  assert.deepEqual([...called].sort(), [
    "direct_quiz_queue_discard", "direct_quiz_queue_health", "direct_quiz_queue_pick",
    "direct_quiz_queue_record", "direct_quiz_queue_status",
  ]);
  for (const name of called) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`));
    assert.match(migration, new RegExp(`'public\\.${name}\\(`));
  }
  assert.match(migration, /grant execute on function %s to knowledge_quiz/);
  assert.match(migration, /revoke all on function %s from public, anon, authenticated/);

  // 旧契約の関数で出題・記録しない
  assert.doesNotMatch(skill, /select direct_quiz_(pick|record)\(/);

  // 回答本文をSQLリテラルへ直接埋め込まない
  assert.match(script, /base64\.b64encode/);
  assert.match(script, /convert_from\(decode\('\{encoded\}', 'base64'\), 'UTF8'\)::jsonb/);
  assert.match(skill, /base64 を使わない記録は契約違反/);

  // チャットの採点ミスでも四択・空欄の補正をすり抜けない
  assert.match(migration, /v_quality := case when v_answer = item\.correct_choice then 4 else least\(v_quality, 1\) end/);
  assert.match(migration, /if v_answer = '' then\s+v_quality := 0;/);
});
