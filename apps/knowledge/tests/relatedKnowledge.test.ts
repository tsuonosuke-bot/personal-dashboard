import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as relatedRoute } from "../functions/api/knowledge/[id]/related.ts";
import { parseRelatedItems } from "../src/lib/apiValidation.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const ID = "11111111-1111-4111-8111-111111111111";

test("関連APIはembedding APIを呼ばず、related_knowledgeの結果を返す", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json([
      { kind: "knowledge", item_id: "22222222-2222-4222-8222-222222222222", title: "認知的不協和", body: "矛盾の不快", knowledge_id: "22222222-2222-4222-8222-222222222222", similarity: 0.68 },
      { kind: "question", item_id: "3", title: "効率的に勉強する", body: "どうしたら効率よく覚えられるか", knowledge_id: null, similarity: 0.6 },
    ]);
  };
  try {
    const response = await relatedRoute({ request: new Request(`https://dashboard.example/api/knowledge/${ID}/related`), params: { id: ID }, env });
    assert.equal(response.status, 200);
    const items = parseRelatedItems(await response.json());
    assert.deepEqual(items.map((item) => item.kind), ["knowledge", "question"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/rest/v1/rpc/related_knowledge");
    assert.deepEqual(calls[0].body, { p_knowledge_id: ID, p_model: "voyage-4", p_per_kind: 4, p_min_similarity: 0.45 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("関連APIはGET以外と不正なIDを拒否し、DBの失敗は502にする", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  try {
    assert.equal((await relatedRoute({ request: new Request(`https://dashboard.example/api/knowledge/${ID}/related`, { method: "POST" }), params: { id: ID }, env })).status, 405);
    assert.equal((await relatedRoute({ request: new Request("https://dashboard.example/api/knowledge/x/related"), params: { id: "x" }, env })).status, 400);
    assert.equal((await relatedRoute({ request: new Request(`https://dashboard.example/api/knowledge/${ID}/related`), params: { id: ID }, env })).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("関連は答え合わせの後だけ出し、問題の表示（回答前）には出さない", async () => {
  const view = await readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8");
  const question = view.slice(view.indexOf("function ReviewQuestionCard"), view.indexOf("function ReviewFeedbackCard"));
  const feedback = view.slice(view.indexOf("function ReviewFeedbackCard"));
  assert.doesNotMatch(question, /RelatedKnowledgePanel/);
  assert.match(feedback, /<RelatedKnowledgePanel knowledgeId=\{question\.knowledge_id\} onOpenKnowledge=\{onOpenKnowledgeId\} \/>/);
});

test("related_knowledgeは自分自身・アーカイブ・外した問いを除き、service_roleだけが実行できる", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261007100000_related_knowledge.sql", import.meta.url), "utf8");
  assert.match(sql, /and not s\.archived\s+and s\.knowledge_id <> p_knowledge_id/);
  assert.match(sql, /question_material_exclusions x\s+where x\.group_id = g\.id and x\.source_type = 'knowledge'/);
  assert.match(sql, /where i\.similarity >= p_min_similarity/);
  assert.ok(sql.includes("revoke all on function public.related_knowledge(uuid, text, integer, double precision) from public, anon, authenticated;"));
  assert.ok(sql.includes("grant execute on function public.related_knowledge(uuid, text, integer, double precision) to service_role;"));
  // コメントを除いた本体が、復習記録や予定に触れないこと
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /quiz_log|record_answer|next_review/);
});
