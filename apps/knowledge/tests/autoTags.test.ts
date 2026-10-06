import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as autoTagsRoute } from "../functions/api/auto-tags.ts";
import { allTagNames, displayTags } from "../src/lib/knowledge.ts";
import { filterTagKnowledge, tagGroupsForKnowledge } from "../src/lib/tagGroups.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/auto-tags", {
    method: "POST",
    headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "auto-tag", ...headers },
    body: JSON.stringify(body),
  });
}

async function withFetch(handler: (url: URL, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try { await run(); } finally { globalThis.fetch = original; }
}

test("自動タグは自分で付けたタグの後に、同じ名前を除いて並べ、絞り込みと集計にも含める", () => {
  const item = { tags: ["読書", "戦略思考"], auto_tags: ["戦略思考", "イシュー・論点"] };
  assert.deepEqual(displayTags(item), [
    { tag: "読書", auto: false }, { tag: "戦略思考", auto: false }, { tag: "イシュー・論点", auto: true },
  ]);
  assert.deepEqual(allTagNames({ tags: [], auto_tags: ["食"] }), ["食"]);
  const knowledge = [
    { ...item, category: "ビジネス", title: "a", explanation: null, source_note: null },
    { tags: [], auto_tags: [], category: "雑学", title: "b", explanation: null, source_note: null },
  ];
  const groups = tagGroupsForKnowledge(knowledge);
  assert.deepEqual(groups.find((group) => group.kind === "tag" && group.tag === "イシュー・論点"), { kind: "tag", tag: "イシュー・論点", count: 1 });
  assert.equal(filterTagKnowledge(knowledge, { kind: "tag", tag: "イシュー・論点" }, "", "").length, 1);
  assert.equal(filterTagKnowledge(knowledge, { kind: "untagged" }, "", "")[0].title, "b");
});

test("自動タグの一覧は、外されていないものだけを近い順で返す", async () => {
  await withFetch((url) => {
    assert.equal(url.pathname, "/rest/v1/knowledge_auto_tags");
    assert.equal(url.searchParams.get("removed_at"), "is.null");
    assert.equal(url.searchParams.get("select"), "knowledge_id,tag,similarity");
    return Response.json([{ knowledge_id: ID, tag: "食", similarity: 0.7 }], { headers: { "Content-Range": "0-0/1" } });
  }, async () => {
    const response = await autoTagsRoute({ request: new Request("https://dashboard.example/api/auto-tags?limit=1000&offset=0"), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].tag, "食");
  });
});

test("自動タグを外す・戻すは、removed_atだけを書き換え、不正な要求は拒否する", async () => {
  const writes: Array<{ url: URL; body: Record<string, unknown> }> = [];
  await withFetch((url, init) => {
    writes.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json([{ knowledge_id: ID, tag: "食", removed_at: null }]);
  }, async () => {
    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: ID, tag: "食", action: "remove" }), env })).status, 200);
    assert.equal(writes[0].url.searchParams.get("tag"), "eq.食");
    assert.equal(typeof writes[0].body.removed_at, "string");
    assert.deepEqual(Object.keys(writes[0].body), ["removed_at"]);
    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: ID, tag: "食", action: "restore" }), env })).status, 200);
    assert.equal(writes[1].body.removed_at, null);

    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: ID, tag: "食", action: "delete" }), env })).status, 400);
    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: "x", tag: "食", action: "remove" }), env })).status, 400);
    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: ID, tag: "食", action: "remove", extra: 1 }), env })).status, 400);
    assert.equal((await autoTagsRoute({ request: post({ knowledge_id: ID, tag: "食", action: "remove" }, { "X-Dashboard-Action": "x" }), env })).status, 403);
    assert.equal(writes.length, 2);
  });
});

test("自動タグのmigrationは、英語・自分で付けたタグ・外したタグを避け、語彙を固定して全件に付ける", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261007110000_auto_tags.sql", import.meta.url), "utf8");
  assert.match(sql, /and k\.category <> '英語'/);
  assert.match(sql, /not \(v\.tag = any\(coalesce\(k\.tags, array\[\]::text\[\]\)\)\)/);
  assert.match(sql, /delete from public\.knowledge_auto_tags a\s+where a\.knowledge_id = any\(v_ids\) and a\.removed_at is null;/);
  assert.match(sql, /on conflict \(knowledge_id, tag\) do nothing;/);
  assert.match(sql, /where r\.rn <= 3 and r\.sim >= 0\.6 and r\.sim >= r\.best - 0\.04/);
  assert.match(sql, /\('WWI', null, 'WWI'\),\('戦車', null, '戦車'\)/);
  // 読書・人物・WWII・単語・文法は語彙に入れない（手付けだけ）
  for (const tag of ["読書", "人物", "WWII", "単語", "文法"]) assert.doesNotMatch(sql, new RegExp(`\\('${tag}', `));
  assert.match(sql, /select public\.assign_auto_tags\('voyage-4', 5000\);/);
  assert.ok(sql.includes("grant execute on function public.assign_auto_tags(text, integer) to service_role;"));
});
