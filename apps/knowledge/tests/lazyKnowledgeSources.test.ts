import assert from "node:assert/strict";
import test from "node:test";
import { getAutoTags, getKnowledgeItem, getKnowledgeSources, updateKnowledge } from "../src/lib/api.ts";
import { getArchivePage } from "../src/lib/learningReadApi.ts";
import { parseDashboardRoute } from "../src/lib/dashboardRoute.ts";
import { loadOrganizeSources, organizeSourceIds, type OrganizeSourceState } from "../src/lib/organizeSources.ts";
import { groupAutoTags, withAutoTags } from "../src/lib/knowledgeAutoTags.ts";
import { displayTags, filterKnowledge } from "../src/lib/knowledge.ts";
import { DEFAULT_FILTERS } from "../src/lib/listState.ts";
import type { KnowledgeInsight } from "../src/types.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-26T01:00:00Z";
function row(overrides: Record<string, unknown> = {}) {
  return { id: ID, title: "アーカイブした出典", explanation: "本文", source_note: null, claim_evidence: null,
    category: "技術", knowledge_kind: "事実", mastery: "学習中", priority: "中", ef: 2.5, reps: 1,
    interval_days: 2, times_asked: 3, times_correct: 2, learned_on: "2026-09-01", last_asked_on: null,
    tags: ["自分のタグ"], accuracy: 2 / 3, next_review_on: "2026-10-27", next_review_at: "2026-10-27T03:00:00Z",
    stability_hours: 48, relearning_stage: null, last_reviewed_at: null, mastery_streak: 1,
    archived: true, content_version: 1, created_at: stamp, ...overrides };
}

test("問いのノート直リンクは手動所属する示唆の出典だけを指定取得し、archivedのタイトルと詳細を解決する", async () => {
  const route = parseDashboardRoute("https://knowledge.example/?view=organize&tab=notes&question=3");
  assert.equal(route.kind, "organize");
  if (route.kind !== "organize") throw new Error("organize route required");
  const insights: KnowledgeInsight[] = [
    { id: 1, knowledge_id: ID, body: "自分で入れた示唆", created_at: stamp, updated_at: stamp },
    { id: 2, knowledge_id: OTHER, body: "別の問いの示唆", created_at: stamp, updated_at: stamp },
    { id: 3, knowledge_id: ID, body: "同じ出典の示唆", created_at: stamp, updated_at: stamp },
  ];
  const members = [{ group_id: 3, insight_id: 1 }, { group_id: 4, insight_id: 2 }, { group_id: 3, insight_id: 3 }];
  assert.deepEqual(organizeSourceIds(route, [], members), []);
  assert.deepEqual(organizeSourceIds(route, insights, []), []);
  const ids = organizeSourceIds(route, insights, members);
  assert.deepEqual(ids, [ID]);
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests++;
    const url = new URL(String(input), "https://knowledge.example");
    assert.equal(url.pathname, "/api/knowledge");
    assert.equal(url.searchParams.get("status"), "all");
    assert.equal(url.searchParams.get("ids"), ID);
    assert.equal(url.searchParams.get("offset"), "0");
    assert.equal(url.searchParams.get("limit"), "100");
    return Response.json({ items: [row()], total: 1, limit: 100, offset: 0 });
  };
  try {
    const sources = await getKnowledgeSources(ids);
    const source = new Map(sources.map((item) => [item.id, item])).get(insights[0].knowledge_id);
    assert.equal(source?.title, "アーカイブした出典");
    assert.equal(source?.archived, true);
    assert.equal(source?.id, ID); // NotesPanel can pass this source to its detail action.
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
  for (const organize of [null, { tab: "notes" as const, questionId: null }, { tab: "tags" as const, questionId: 3 }]) {
    assert.deepEqual(organizeSourceIds(organize, insights, members), []);
  }
  assert.deepEqual(organizeSourceIds({ tab: "insights", questionId: null }, insights, members), [ID, OTHER]);
});

test("別取得の自動タグをlazy archive・出典・復元の応答へ引き継ぎ、再読込前からタグ検索に含める", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://knowledge.example");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/auto-tags") return Response.json({ items: [
      { knowledge_id: ID, tag: "自動分類", similarity: 0.9 },
      { knowledge_id: ID, tag: "比較", similarity: 0.8 },
    ], total: 2, limit: 1000, offset: 0 });
    if (url.pathname === `/api/knowledge/${ID}`) {
      if (init?.method === "GET") return Response.json(row());
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init?.body)), { expected_version: 1, changes: { archived: false } });
      return Response.json(row({ archived: false, content_version: 2 }));
    }
    assert.equal(url.pathname, "/api/knowledge");
    if (url.searchParams.get("status") === "archived") {
      assert.equal(url.searchParams.get("limit"), "30");
      return Response.json({ items: [row()], total: 1, limit: 30, offset: 0 });
    }
    assert.equal(url.searchParams.get("ids"), ID);
    return Response.json({ items: [row()], total: 1, limit: 100, offset: 0 });
  };
  try {
    // This metadata is available before the archived card's body has been loaded.
    const byId = groupAutoTags(await getAutoTags());
    const page = await getArchivePage("", 0, 30);
    const archived = withAutoTags(page.items[0], byId);
    const source = withAutoTags((await getKnowledgeSources([ID]))[0], byId);
    assert.deepEqual(archived.auto_tags, ["自動分類", "比較"]);
    assert.deepEqual(source.auto_tags, archived.auto_tags);
    assert.deepEqual(withAutoTags(await getKnowledgeItem(ID), byId).auto_tags, archived.auto_tags);
    const restored = withAutoTags(await updateKnowledge(ID, archived.content_version, { archived: false }), byId);
    assert.equal(restored.archived, false);
    assert.deepEqual(displayTags(restored), [
      { tag: "自分のタグ", auto: false }, { tag: "自動分類", auto: true }, { tag: "比較", auto: true },
    ]);
    assert.deepEqual(filterKnowledge([restored], { ...DEFAULT_FILTERS, search: "自動分類" }).map((item) => item.id), [ID]);
    assert.deepEqual(calls, ["GET /api/auto-tags", "GET /api/knowledge", "GET /api/knowledge", `GET /api/knowledge/${ID}`, `PATCH /api/knowledge/${ID}`]);
    // A successful subsequent tag refresh is authoritative, including removed tags.
    assert.deepEqual(withAutoTags(restored, groupAutoTags([])).auto_tags, []);
  } finally { globalThis.fetch = original; }
});

test("ノート出典の取得失敗は表示可能な状態となり、同じ必要IDだけの再試行でarchived出典を回復する", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const states: OrganizeSourceState[] = [];
  let sources: Awaited<ReturnType<typeof getKnowledgeSources>> = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://knowledge.example");
    assert.equal(url.pathname, "/api/knowledge");
    assert.equal(url.searchParams.get("status"), "all");
    calls.push(url.searchParams.get("ids") ?? "");
    return calls.length === 1 ? Response.json({ error: "合成の一時エラー" }, { status: 503 })
      : Response.json({ items: [row()], total: 1, limit: 100, offset: 0 });
  };
  try {
    const load = async (ids: readonly string[]) => { sources = await getKnowledgeSources(ids); };
    await loadOrganizeSources([ID], load, (state) => states.push(state));
    assert.equal(sources.length, 0);
    assert.equal(states[0].loading, true);
    assert.equal(states[1].loading, false);
    assert.equal(typeof states[1].error, "string");
    assert.match(states[1].error!, /合成の一時エラー/);
    await loadOrganizeSources([ID], load, (state) => states.push(state));
    assert.deepEqual(states.slice(2), [{ loading: true, error: null }, { loading: false, error: null }]);
    assert.deepEqual(calls, [ID, ID]);
    assert.equal(sources[0].title, "アーカイブした出典");
    assert.equal(sources[0].archived, true);
  } finally { globalThis.fetch = original; }
});
