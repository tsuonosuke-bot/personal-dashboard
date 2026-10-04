import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/202610050001_advisor_cleanup.sql", import.meta.url), "utf8");

test("Advisors対応は3関数のsearch_pathを固定する", () => {
  for (const fn of [
    "complete_want_after_route()",
    "ensure_scheduled_action_after_calendar_route()",
    "next_recurring_date(date, text, integer, integer)",
  ]) {
    assert.ok(sql.includes(`alter function public.${fn} set search_path = '';`), fn);
  }
});

test("Advisors対応は未使用の拡張を消し、pg_trgmをextensionsへ移す", () => {
  assert.match(sql, /drop extension if exists postgres_fdw;/);
  assert.match(sql, /alter extension pg_trgm set schema extensions;/);
});

test("Advisors対応は外部キー8件にインデックスを作り、消える表には作らない", () => {
  const indexes = [...sql.matchAll(/create index if not exists \w+ on public\.(\w+) \((\w+)\);/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(indexes.sort(), [
    "expenses.category", "focus_items.source_want_id", "habits.source_want_id", "project_actions.project_item_id",
    "quiz_log.knowledge_id", "recurring_expenses.category", "recurring_expenses.template_rule_id", "writing_topics.source_want_id",
  ]);
  assert.doesNotMatch(sql, /^create index.*daily_review_queue_items/m);
});

test("Advisors対応は破壊的な変更（drop table / delete / truncate）を含まない", () => {
  assert.doesNotMatch(sql, /^\s*(drop table|delete from|truncate)/im);
});
