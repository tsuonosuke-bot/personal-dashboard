import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("自分の情報は専用の表に置き、AIに渡さない行はスキルが読むビューに出さない", async () => {
  const [skill, sql] = await Promise.all([
    read("../skills/my-profile/SKILL.md"),
    read("../supabase/migrations/202610080001_personal_profile.sql"),
  ]);

  assert.match(skill, /^---\nname: my-profile\ndescription: /);

  // ブラウザ（anon）からは読めず、service_role だけ
  assert.match(sql, /alter table public\.personal_profile enable row level security;/);
  assert.match(sql, /revoke all on table public\.personal_profile from public, anon, authenticated;/);
  assert.match(sql, /revoke all on table public\.personal_profile_for_ai from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.replace_personal_profile\(text, text, text, text, date\) from public, anon, authenticated;/);

  // ビューは ai_visible の行だけ。スキルの読み取りはビューからだけ
  assert.match(sql, /create or replace view public\.personal_profile_for_ai[\s\S]*?where ai_visible/);
  const selects = [...skill.matchAll(/select[\s\S]*?from public\.(personal_profile\w*)[\s\S]*?;/g)];
  assert.ok(selects.length >= 3);
  for (const [statement, table] of selects) {
    if (table === "personal_profile") {
      // 非公開の行を戻すための一覧だけは、中身（value・detail）を読まない
      assert.match(statement, /select id, category, name from public\.personal_profile where not ai_visible/);
    } else {
      assert.equal(table, "personal_profile_for_ai");
    }
  }
  assert.doesNotMatch(skill, /select \* from public\.personal_profile\b(?!_for_ai)/);

  // スキルの分類表とDBの制約が同じ
  const constraint = sql.match(/category in \(([^)]+)\)/)?.[1] ?? "";
  const dbCategories = [...constraint.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const skillCategories = [...skill.matchAll(/^\| (\S+) \| .+ \|$/gm)].map((match) => match[1]).filter((name) => name !== "category" && name !== "---");
  assert.deepEqual(skillCategories, dbCategories);

  // 買い替えは上書きせず、古い行を終えて新しい行を足す
  assert.match(sql, /set until = greatest\(v_since - 1, coalesce\(since, v_since - 1\)\)/);
  assert.match(sql, /where until is null;/);
  assert.match(skill, /replace_personal_profile\('デバイス'/);

  // 入れない情報と、勝手に書かない決まり
  assert.match(skill, /口座番号・カード番号・パスワード/);
  assert.match(skill, /\*\*登録してよいか先に尋ねる\*\*/);
  assert.doesNotMatch(skill, /insert into public\.(knowledge|idea_inbox|daily_journal)\b/);
});
