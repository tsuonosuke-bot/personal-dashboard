import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as batchRoute } from "../functions/api/embedding-batch.ts";
import { onRequest as searchRoute } from "../functions/api/semantic-search.ts";
import { onRequest as statusRoute } from "../functions/api/semantic-search/status.ts";
import { hasReviewBatchToken } from "../functions/_shared/reviewQueue.ts";
import { readSearchRequest, runEmbeddingBatch } from "../functions/_shared/semanticSearch.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, readEmbeddings } from "../functions/_shared/voyageClient.ts";
import { dashboardRoutePath, parseDashboardRoute } from "../src/lib/dashboardRoute.ts";
import { parseSemanticIndexStatus, parseSemanticSearchResults } from "../src/lib/apiValidation.ts";

const TOKEN = "t".repeat(40);
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret",
  VOYAGE_API_KEY: "voyage-key",
  REVIEW_BATCH_TOKEN: TOKEN,
};

type Rpc = { name: string; body: Record<string, unknown> };
type VoyageCall = { body: Record<string, unknown>; authorization: string | null };

function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed % EMBEDDING_DIMENSIONS ? 1 : 0));
}

function voyageBody(count: number, offset = 0) {
  // 応答の並びは入力と逆にし、indexで並べ直していることを確かめる。
  return {
    object: "list",
    data: Array.from({ length: count }, (_, i) => ({ object: "embedding", index: i, embedding: vector(offset + i) })).reverse(),
    model: EMBEDDING_MODEL,
    usage: { total_tokens: count * 10 },
  };
}

/** Supabase RPC と Voyage への通信を記録し、用意した応答を返す。 */
async function withServices(
  handlers: {
    rpc?: (name: string, body: Record<string, unknown>) => unknown;
    voyage?: (body: Record<string, unknown>, index: number) => Response | unknown;
  },
  run: (calls: { rpc: Rpc[]; voyage: VoyageCall[] }) => Promise<void>,
): Promise<void> {
  const calls = { rpc: [] as Rpc[], voyage: [] as VoyageCall[] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.hostname === "api.voyageai.com") {
      const headers = new Headers(init?.headers);
      calls.voyage.push({ body, authorization: headers.get("Authorization") });
      if (!handlers.voyage) throw new Error("unexpected Voyage call");
      const result = handlers.voyage(body, calls.voyage.length - 1);
      return result instanceof Response ? result : Response.json(result);
    }
    const name = url.pathname.replace("/rest/v1/rpc/", "");
    calls.rpc.push({ name, body });
    if (!handlers.rpc) throw new Error(`unexpected rpc ${name}`);
    return Response.json(handlers.rpc(name, body));
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function target(i: number) {
  return { source_type: "knowledge", source_id: `k-${i}`, input_text: `本文${i}`, input_hash: `h${i}` };
}

function pageRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://dashboard.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "semantic-search",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Voyageの応答はindexで入力順に並べ直し、件数・次元・番号の重複を拒否する", () => {
  const parsed = readEmbeddings(voyageBody(3), 3);
  assert.deepEqual(parsed?.embeddings.map((v) => v.indexOf(1)), [0, 1, 2]);
  assert.equal(parsed?.tokens, 30);
  assert.equal(readEmbeddings(voyageBody(2), 3), null);
  assert.equal(readEmbeddings({ data: [{ index: 0, embedding: [1, 2, 3] }] }, 1), null);
  assert.equal(readEmbeddings({ data: [{ index: 0, embedding: vector(0) }, { index: 0, embedding: vector(1) }] }, 2), null);
});

test("embedTextsはキーが無ければ通信せず、あればモデル・種類・次元を指定して送る", async () => {
  await withServices({ voyage: () => voyageBody(1) }, async (calls) => {
    const missing = await embedTexts({}, ["a"], "query");
    assert.deepEqual(missing.ok ? null : missing.status, 503);
    assert.equal(calls.voyage.length, 0);

    const result = await embedTexts(env, ["検索語"], "query");
    assert.equal(result.ok, true);
    assert.deepEqual(calls.voyage[0].body, {
      input: ["検索語"], model: EMBEDDING_MODEL, input_type: "query", output_dimension: EMBEDDING_DIMENSIONS,
    });
    assert.equal(calls.voyage[0].authorization, "Bearer voyage-key");
  });
  await withServices({ voyage: () => new Response("busy", { status: 429 }) }, async () => {
    const result = await embedTexts(env, ["a"], "document");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /HTTP 429/);
  });
});

test("バッチはキーが未設定ならDBにもVoyageにも触れずに見送る", async () => {
  await withServices({}, async (calls) => {
    const summary = await runEmbeddingBatch({ ...env, VOYAGE_API_KEY: " " });
    assert.equal(summary.status, "skipped");
    assert.match(summary.note ?? "", /VOYAGE_API_KEY/);
    assert.equal(calls.rpc.length + calls.voyage.length, 0);
  });
});

test("バッチは128件ずつembeddingにし、文の版（hash）を添えて保存する", async () => {
  const picked = Array.from({ length: 130 }, (_, i) => target(i));
  await withServices({
    rpc: (name, body) => {
      if (name === "pick_semantic_embedding_targets") return picked;
      if (name === "assign_auto_tags") return 7;
      if (name === "save_semantic_embeddings") {
        const items = body.p_items as unknown[];
        // 2回目の保存では、処理中に文が変わった1件をDBが捨てた想定。
        return items.length === 2 ? 1 : items.length;
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    voyage: (body, index) => voyageBody((body.input as string[]).length, index * 128),
  }, async (calls) => {
    const summary = await runEmbeddingBatch(env);
    assert.deepEqual(calls.rpc[0], { name: "pick_semantic_embedding_targets", body: { p_model: EMBEDDING_MODEL, p_limit: 512 } });
    assert.deepEqual(calls.voyage.map((call) => (call.body.input as string[]).length), [128, 2]);
    assert.equal(calls.voyage[0].body.input_type, "document");
    const saves = calls.rpc.filter((call) => call.name === "save_semantic_embeddings");
    assert.equal(saves.length, 2);
    const first = (saves[0].body.p_items as Record<string, unknown>[])[5];
    assert.deepEqual({ ...first, embedding: (first.embedding as number[]).indexOf(1) }, {
      source_type: "knowledge", source_id: "k-5", input_hash: "h5", embedding: 5,
    });
    assert.equal(saves[1].body.p_model, EMBEDDING_MODEL);
    assert.deepEqual(
      { status: summary.status, picked: summary.picked, saved: summary.saved, tokens: summary.tokens },
      { status: "succeeded", picked: 130, saved: 129, tokens: 1300 },
    );
    // 保存の後に、embeddingが新しくなったナレッジへ自動タグを付ける（#93）
    assert.equal(summary.tagged, 7);
    assert.deepEqual(calls.rpc.at(-1), { name: "assign_auto_tags", body: { p_model: EMBEDDING_MODEL, p_limit: 1000 } });
    assert.match(summary.note ?? "", /1件は、次の実行で付け直します/);
  });
});

test("バッチはVoyageが失敗したらそこで止め、保存できた件数を残す", async () => {
  const picked = Array.from({ length: 200 }, (_, i) => target(i));
  await withServices({
    rpc: (name, body) => (name === "pick_semantic_embedding_targets" ? picked : (body.p_items as unknown[]).length),
    voyage: (body, index) => (index === 0 ? voyageBody((body.input as string[]).length) : new Response("", { status: 401 })),
  }, async (calls) => {
    const summary = await runEmbeddingBatch(env);
    assert.equal(summary.status, "failed");
    assert.equal(summary.saved, 128);
    assert.match(summary.note ?? "", /HTTP 401.*200件中128件を保存済み/);
    assert.equal(calls.rpc.filter((call) => call.name === "save_semantic_embeddings").length, 1);
  });
});

test("バッチAPIは合言葉か、画面からの同一オリジン・専用ヘッダーの要求だけを受け付ける", async () => {
  const cron = new Request("https://dashboard.example/api/embedding-batch", {
    method: "POST", headers: { "X-Review-Batch-Token": TOKEN }, body: "{}",
  });
  assert.equal(hasReviewBatchToken(cron, env), true);
  await withServices({ rpc: () => [] }, async (calls) => {
    const scheduled = await batchRoute({ request: cron, env });
    assert.equal(scheduled.status, 200);
    assert.equal(((await scheduled.json()) as { status: string }).status, "skipped");

    const foreign = await batchRoute({
      request: new Request("https://dashboard.example/api/embedding-batch", { method: "POST", body: "{}" }),
      env,
    });
    assert.equal(foreign.status, 403);
    const wrongAction = await batchRoute({ request: pageRequest("/api/embedding-batch", {}, { "X-Dashboard-Action": "review-queue" }), env });
    assert.equal(wrongAction.status, 403);
    const manual = await batchRoute({ request: pageRequest("/api/embedding-batch", {}), env });
    assert.equal(manual.status, 200);
    // 合言葉と画面の2回とも、対象選び→自動タグの順に呼ぶ
    assert.deepEqual(calls.rpc.map((call) => call.name), [
      "pick_semantic_embedding_targets", "assign_auto_tags", "pick_semantic_embedding_targets", "assign_auto_tags",
    ]);
  });
});

test("検索要求は文を必須にし、種類と件数を検証する", () => {
  assert.deepEqual(readSearchRequest({ query: "  失敗から学ぶ  " }), {
    ok: true, value: { query: "失敗から学ぶ", types: ["knowledge", "insight", "journal"], limit: 20 },
  });
  assert.deepEqual(readSearchRequest({ query: "a", types: ["journal", "knowledge"], limit: 5 }), {
    ok: true, value: { query: "a", types: ["knowledge", "journal"], limit: 5 },
  });
  assert.equal(readSearchRequest({ query: " " }).ok, false);
  assert.equal(readSearchRequest({ query: "a".repeat(501) }).ok, false);
  assert.equal(readSearchRequest({ query: "a", types: [] }).ok, false);
  assert.equal(readSearchRequest({ query: "a", types: ["wants"] }).ok, false);
  assert.equal(readSearchRequest({ query: "a", limit: 51 }).ok, false);
});

test("検索APIは検索語をqueryとしてembeddingにし、近い順の結果を返す", async () => {
  const row = {
    source_type: "journal", source_id: "2026-10-04", title: "2026-10-04の日記", body: "ジムへ行った",
    meta: "育児・家族", knowledge_id: null, entry_date: "2026-10-04", similarity: 0.71,
  };
  await withServices({
    rpc: (name) => {
      assert.equal(name, "search_semantic");
      return [row];
    },
    voyage: () => voyageBody(1, 7),
  }, async (calls) => {
    const response = await searchRoute({ request: pageRequest("/api/semantic-search", { query: "運動", types: ["journal"] }), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { results: [row] });
    assert.deepEqual(parseSemanticSearchResults(body), [row]);
    assert.equal(calls.voyage[0].body.input_type, "query");
    const args = calls.rpc[0].body;
    assert.deepEqual({ ...args, p_embedding: JSON.parse(String(args.p_embedding)).indexOf(1) }, {
      p_embedding: 7, p_model: EMBEDDING_MODEL, p_types: ["journal"], p_limit: 20,
    });
  });
});

test("検索APIはGET・別オリジン・空の検索語・キー未設定を拒否する", async () => {
  await withServices({}, async (calls) => {
    assert.equal((await searchRoute({ request: new Request("https://dashboard.example/api/semantic-search"), env })).status, 405);
    assert.equal((await searchRoute({
      request: pageRequest("/api/semantic-search", { query: "a" }, { Origin: "https://evil.example" }), env,
    })).status, 403);
    assert.equal((await searchRoute({ request: pageRequest("/api/semantic-search", { query: "" }), env })).status, 400);
    const noKey = await searchRoute({ request: pageRequest("/api/semantic-search", { query: "a" }), env: { ...env, VOYAGE_API_KEY: undefined } });
    assert.equal(noKey.status, 503);
    assert.match(((await noKey.json()) as { error: string }).error, /VOYAGE_API_KEY/);
    assert.equal(calls.rpc.length + calls.voyage.length, 0);
  });
});

test("索引の状態APIは種類ごとの件数と、キーの設定有無を返す", async () => {
  const items = [
    { source_type: "knowledge", total: 494, embedded: 490, last_embedded_at: "2026-10-05T10:40:00+00:00" },
    { source_type: "insight", total: 30, embedded: 30, last_embedded_at: null },
    { source_type: "journal", total: 247, embedded: 0, last_embedded_at: null },
  ];
  await withServices({ rpc: () => items }, async (calls) => {
    const response = await statusRoute({ request: new Request("https://dashboard.example/api/semantic-search/status"), env });
    const body = await response.json();
    assert.deepEqual(body, { model: EMBEDDING_MODEL, configured: true, items });
    assert.deepEqual(calls.rpc[0], { name: "get_semantic_index_status", body: { p_model: EMBEDDING_MODEL } });
    assert.equal(parseSemanticIndexStatus(body).items[2].embedded, 0);
  });
  await withServices({ rpc: () => [{ source_type: "wants", total: 1, embedded: 0 }] }, async () => {
    const response = await statusRoute({ request: new Request("https://dashboard.example/api/semantic-search/status"), env });
    assert.equal(response.status, 502);
  });
});

test("view=search で意味検索の画面を開ける", () => {
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=search"), { kind: "search" });
  assert.equal(dashboardRoutePath("https://knowledge.example/?knowledge=x", { kind: "search" }), "/?view=search");
});

test("マイグレーションは検索関数をservice_roleだけに開き、毎時40分にバッチを呼ぶ", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261005130000_semantic_embeddings.sql", import.meta.url), "utf8");
  assert.match(sql, /embedding extensions\.vector\(1024\)/);
  for (const fn of ["semantic_sources()", "pick_semantic_embedding_targets(text, integer)", "save_semantic_embeddings(text, jsonb)",
    "search_semantic(text, text, text[], integer)", "get_semantic_index_status(text)", "trigger_embedding_batch()"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.match(sql, /cron\.schedule\('semantic-embeddings', '40 \* \* \* \*'/);
  assert.match(sql, /'https:\/\/knowledge-50b\.pages\.dev\/api\/embedding-batch'/);
});
