import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("pending-routes スキルは want_routes の planned だけを待ちとして扱い、Hubの登録済みにすると同じ値を書く", async () => {
  const [skill, completion] = await Promise.all([
    read("../skills/pending-routes/SKILL.md"),
    read("../functions/_shared/wantRouteCompletion.ts"),
  ]);

  assert.match(skill, /^---\nname: pending-routes\ndescription: /);
  assert.match(skill, /where r\.status = 'planned' and r\.destination in \('github', 'knowledge'\)/);

  // Hub（completeWantRoute）と同じ列・同じ正本リンクの形にする
  assert.match(completion, /status: "created",\s+target_id: target\.targetId,\s+target_url: target\.targetUrl,\s+error_code: null,/);
  assert.match(completion, /targetUrl: `\/knowledge\/\?knowledge=\$\{encodeURIComponent\(input\.knowledgeId\)\}`/);
  assert.match(skill, /target_url = '\/knowledge\/\?knowledge=<knowledgeのuuid>'/);
  assert.match(skill, /target_url = 'https:\/\/github\.com\/tsuonosuke-bot\/<repo>\/issues\/<Issue番号>'/);

  // planned 以外は上書きしない（Hubの楽観的な競合検出と同じ条件）
  const updates = [...skill.matchAll(/update public\.want_routes[\s\S]*?;/g)].map((match) => match[0]);
  assert.equal(updates.length, 3);
  for (const sql of updates) {
    assert.match(sql, /and status = 'planned'/);
    assert.match(sql, /error_code = null, updated_at = now\(\)/);
    assert.match(sql, /returning id, status/);
  }
  assert.ok(updates.some((sql) => /set status = 'cancelled'/.test(sql)));

  // idea_inbox と wants は書き換えない
  assert.doesNotMatch(skill, /update public\.(idea_inbox|wants)\b/i);
  assert.doesNotMatch(skill, /insert into public\.want_routes/i);

  // 承認前は書き込まず、Issue本文に照合用の印を残す
  assert.match(skill, /承認を得るまでは、Issue作成・ナレッジ登録・`want_routes` の更新を一切しない/);
  assert.match(skill, /\(idea_inbox #<inbox_id> \/ want_routes #<route_id>\)/);
});
