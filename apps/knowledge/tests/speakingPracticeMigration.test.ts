import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("英会話練習の移行は専用履歴だけを作り、復習スケジュールを更新しない", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260921130000_speaking_practice.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create table if not exists public\.speaking_practice_log/i);
  assert.match(sql, /attempt_id uuid not null unique/i);
  assert.match(sql, /create or replace function public\.record_speaking_practice/i);
  assert.match(sql, /on conflict \(attempt_id\) do nothing/i);
  assert.match(sql, /where k\.id = p_knowledge_id and k\.archived = false/i);
  assert.doesNotMatch(sql, /update\s+public\.knowledge/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.quiz_log/i);
  assert.doesNotMatch(sql, /record_answer\s*\(/i);
});
