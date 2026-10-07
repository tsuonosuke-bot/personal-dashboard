import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as notesRoute } from "../functions/api/notes.ts";
import { onRequest as themeRoute } from "../functions/api/notes/theme.ts";
import { onRequest as serveRoute } from "../functions/api/review-queue/serve.ts";
import { readThemeMaterialChange, THEME_MIN_SIMILARITY } from "../functions/_shared/notes.ts";
import { dashboardRoutePath, parseDashboardRoute } from "../src/lib/dashboardRoute.ts";
import { parseNoteTopics, parseThemeNote } from "../src/lib/apiValidation.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const K1 = "11111111-1111-4111-8111-111111111111";
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function withFetch(
  handler: (url: URL, init?: RequestInit) => unknown,
  run: (calls: { url: URL; body: unknown; method: string }[]) => Promise<void>,
): Promise<void> {
  const calls: { url: URL; body: unknown; method: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, method: init?.method ?? "GET" });
    return Response.json(await handler(url, init));
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function noteRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://dashboard.example/api/notes/theme", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "knowledge-note",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("ノートの一覧は問いとテーマを件数つきで返し、問いは材料と同じ基準で数える", async () => {
  const topics = [
    { kind: "question", key: "3", title: "失敗から改善を生む", guiding_question: "失敗を改善につなげるには？", knowledge_count: 8, insight_count: 7, journal_count: 8, materials_ready: true },
    { kind: "theme", key: "失敗と改善", title: "失敗と改善", guiding_question: null, knowledge_count: 6, insight_count: 2, journal_count: 1, materials_ready: true },
  ];
  await withFetch(() => topics, async (calls) => {
    const response = await notesRoute({ request: new Request("https://dashboard.example/api/notes"), env });
    assert.equal(response.status, 200);
    assert.deepEqual(parseNoteTopics(await response.json()), topics);
    assert.equal(calls[0].url.pathname, "/rest/v1/rpc/list_note_topics");
    assert.deepEqual(calls[0].body, {
      p_model: "voyage-4",
      p_question_per_type: 8,
      p_question_min_similarity: 0.45,
      p_theme_per_type: 8,
      p_theme_min_similarity: THEME_MIN_SIMILARITY,
    });
  });
});

test("テーマのノートは語彙にあるタグだけを返し、自分で付けたタグのナレッジは近さなしで返す", async () => {
  const materials = [
    { source_type: "knowledge", source_id: K1, title: "クローズドループ現象", body: "説明", meta: "ビジネス", knowledge_id: K1, entry_date: null, similarity: null, origin: "own_tag" },
    { source_type: "journal", source_id: "2025-08-09", title: "2025-08-09の日記", body: "要約", meta: null, knowledge_id: null, entry_date: "2025-08-09", similarity: 0.77, origin: "nearby" },
  ];
  await withFetch((url) => {
    if (url.pathname === "/rest/v1/knowledge_tag_vocabulary") return url.searchParams.get("tag") === "eq.失敗と改善" ? [{ tag: "失敗と改善" }] : [];
    if (url.pathname === "/rest/v1/rpc/list_theme_materials") return materials;
    if (url.pathname === "/rest/v1/rpc/list_theme_exclusions") return [];
    throw new Error(`unexpected ${url}`);
  }, async () => {
    const found = await themeRoute({ request: new Request(`https://dashboard.example/api/notes/theme?tag=${encodeURIComponent("失敗と改善")}`), env });
    assert.equal(found.status, 200);
    const note = parseThemeNote(await found.json());
    assert.equal(note.tag, "失敗と改善");
    assert.equal(note.materials[0].similarity, null);
    assert.equal(note.materials[0].origin, "own_tag");

    const missing = await themeRoute({ request: new Request(`https://dashboard.example/api/notes/theme?tag=${encodeURIComponent("読書")}`), env });
    assert.equal(missing.status, 404);
    assert.equal((await themeRoute({ request: new Request("https://dashboard.example/api/notes/theme"), env })).status, 400);
  });
});

test("テーマから外せるのは示唆と日記で、外したものは記録して戻せる", async () => {
  assert.equal(readThemeMaterialChange({ tag: "失敗と改善", action: "exclude", source_type: "knowledge", source_id: K1 }).ok, false);
  assert.equal(readThemeMaterialChange({ tag: "失敗と改善", action: "exclude", source_type: "insight", source_id: "abc" }).ok, false);
  assert.equal(readThemeMaterialChange({ tag: "失敗と改善", action: "exclude", source_type: "journal", source_id: "2025-8-9" }).ok, false);
  assert.equal(readThemeMaterialChange({ tag: " ", action: "exclude", source_type: "insight", source_id: "12" }).ok, false);
  assert.equal(readThemeMaterialChange({ tag: "失敗と改善", action: "exclude", source_type: "insight", source_id: "12", extra: 1 }).ok, false);

  await withFetch(() => [{ tag: "失敗と改善" }], async (calls) => {
    const excluded = await themeRoute({ request: noteRequest({ tag: "失敗と改善", action: "exclude", source_type: "insight", source_id: "12" }), env });
    assert.equal(excluded.status, 200);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url.pathname, "/rest/v1/theme_material_exclusions");
    assert.deepEqual(calls[0].body, { tag: "失敗と改善", source_type: "insight", source_id: "12" });

    const restored = await themeRoute({ request: noteRequest({ tag: "失敗と改善", action: "restore", source_type: "journal", source_id: "2025-08-09" }), env });
    assert.equal(restored.status, 200);
    assert.equal(calls[1].method, "DELETE");
    assert.equal(calls[1].url.searchParams.get("source_id"), "eq.2025-08-09");

    const forbidden = await themeRoute({ request: noteRequest({ tag: "失敗と改善", action: "exclude", source_type: "insight", source_id: "12" }, { "X-Dashboard-Action": "x" }), env });
    assert.equal(forbidden.status, 403);
    assert.equal(calls.length, 2);
  });
});

test("ノートの復習は渡したナレッジの問題だけを出し、指定が無ければ今までどおり出す", async () => {
  const reviewRequest = (body: unknown) => new Request("https://dashboard.example/api/review-queue/serve", {
    method: "POST",
    headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "review-queue" },
    body: JSON.stringify(body),
  });
  await withFetch(() => [], async (calls) => {
    assert.equal((await serveRoute({ request: reviewRequest({ limit: 30, knowledge_ids: [K1.toUpperCase()] }), env })).status, 200);
    assert.equal(calls[0].url.pathname, "/rest/v1/rpc/serve_review_queue_filtered");
    assert.deepEqual(calls[0].body, { p_limit: 30, p_categories: null, p_knowledge_ids: [K1] });

    assert.equal((await serveRoute({ request: reviewRequest({ limit: 30 }), env })).status, 200);
    assert.equal(calls[1].url.pathname, "/rest/v1/rpc/serve_review_queue");

    for (const ids of [[], ["not-a-uuid"], "x", Array.from({ length: 201 }, () => K1)]) {
      assert.equal((await serveRoute({ request: reviewRequest({ limit: 30, knowledge_ids: ids }), env })).status, 400);
    }
    assert.equal(calls.length, 2);
  });
});

test("ノートは整理ページのタブで開き、問いかテーマをURLで指す", () => {
  assert.deepEqual(parseDashboardRoute("https://x.test/?view=organize&tab=notes&theme=%E5%A4%B1%E6%95%97%E3%81%A8%E6%94%B9%E5%96%84"), {
    kind: "organize", tab: "notes", questionId: null, theme: "失敗と改善",
  });
  assert.deepEqual(parseDashboardRoute("https://x.test/?view=organize&tab=notes&question=3&theme=x"), {
    kind: "organize", tab: "notes", questionId: 3, theme: null,
  });
  assert.equal(
    decodeURIComponent(dashboardRoutePath("https://x.test/?view=organize&tab=notes&question=3", { kind: "organize", tab: "notes", questionId: null, theme: "失敗と改善" })),
    "/?view=organize&tab=notes&theme=失敗と改善",
  );
  // 他のタブではテーマを残さない
  assert.equal(dashboardRoutePath("https://x.test/?view=organize&tab=notes&theme=x", { kind: "organize", tab: "tags", questionId: null }), "/?view=organize&tab=tags");
});

test("ノート画面は外す・詳細・期限分の復習を出し、テーマのナレッジは自動タグを外して抜く", async () => {
  const [panel, organize, app, review] = await Promise.all([
    read("src/components/NotesPanel.tsx"), read("src/components/OrganizeView.tsx"), read("src/App.tsx"), read("src/components/ReviewView.tsx"),
  ]);
  assert.match(organize, /\{ tab: "notes", label: "ノート" \}/);
  assert.match(organize, /<NotesPanel/);
  assert.match(panel, /onRemoveAutoTag\(id, selection\.tag\) : onRestoreAutoTag\(id, selection\.tag\)/);
  assert.match(panel, /changeThemeMaterial\(selection\.tag, action, type, id\)/);
  assert.match(panel, /changeQuestionMaterial\(selection\.id, action, type, id\)/);
  // 自分で付けたタグのナレッジと、自分で入れた示唆は外せない
  assert.match(panel, /removable: item\.origin !== "own_tag"/);
  assert.match(panel, /reason: "自分で入れた示唆",\s+removable: false/);
  assert.match(panel, /onOpenKnowledge\(source\)/);
  assert.match(panel, /このノートを復習（期限 \{dueCount\}枚）/);
  assert.match(app, /setReviewScope\(\{ \.\.\.scope, returnTo: noteSelection \}\)/);
  assert.match(review, /useReviewSession\(onRecorded, scope\?\.knowledgeIds\)/);
  assert.match(review, /復習の予定は前倒ししません/);
});

test("テーマのノートのマイグレーションは、外したものを除き、出題の契約を変えない", async () => {
  const sql = await read("supabase/migrations/20261008100000_theme_notes.sql");
  assert.match(sql, /references public\.knowledge_tag_vocabulary\(tag\) on delete cascade on update cascade/);
  assert.match(sql, /check \(source_type in \('insight', 'journal'\)\)/);
  assert.match(sql, /theme_material_exclusions x\s+where x\.tag = t\.tag and x\.source_type = e\.source_type/);
  assert.match(sql, /a\.removed_at is null/);
  assert.match(sql, /and \(p_knowledge_ids is null or k\.id = any\(p_knowledge_ids\)\)/);
  // knowledge-quizスキルが確かめる serve_review_queue(integer, text[]) は同じ引数のまま残す
  assert.match(sql, /create or replace function public\.serve_review_queue\(\s+p_limit integer default 15,\s+p_categories text\[\] default null\s+\)/);
  assert.match(sql, /serve_review_queue_filtered\(p_limit, p_categories, null\)/);
  for (const fn of ["theme_material_keys(text, integer, double precision)", "list_theme_materials(text, text, integer, double precision)",
    "list_theme_exclusions(text)", "list_note_topics(text, integer, double precision, integer, double precision)",
    "serve_review_queue_filtered(integer, text[], uuid[])", "serve_review_queue(integer, text[])"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
});
