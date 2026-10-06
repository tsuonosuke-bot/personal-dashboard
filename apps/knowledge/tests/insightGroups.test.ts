import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as groupsRoute } from "../functions/api/insight-groups.ts";
import { onRequest as groupRoute } from "../functions/api/insight-groups/[id].ts";
import { onRequest as materialsRoute } from "../functions/api/insight-groups/[id]/materials.ts";
import { deriveQuestionTitle } from "../functions/_shared/insightGroupValidation.ts";
import { parseQuestionMaterials } from "../src/lib/apiValidation.ts";
import { onRequest as membersRoute } from "../functions/api/insight-group-members.ts";
import { parseInsightGroup, parseInsightGroupMember } from "../src/lib/apiValidation.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
const timestamp = "2026-09-25T01:00:00.123456+00:00";
const group = {
  id: 7,
  title: "失敗から改善を生む",
  guiding_question: "失敗を改善につなげるには？",
  created_at: timestamp,
  updated_at: timestamp,
};
const member = { group_id: 7, insight_id: 11 };

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://dashboard.example${path}`, {
    method,
    headers: {
      Origin: "https://dashboard.example",
      "X-Dashboard-Action": "knowledge-insight-group",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("問いグループを保存し、制限付きページングで取得する", async () => {
  await withFetch((url, init) => {
    assert.equal(url.pathname, "/rest/v1/insight_groups");
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)), {
        title: group.title,
        guiding_question: group.guiding_question,
      });
      return Response.json([group], { status: 201 });
    }
    assert.equal(url.searchParams.get("order"), "created_at.asc,id.asc");
    return Response.json([group], { headers: { "Content-Range": "0-0/1" } });
  }, async () => {
    const created = await groupsRoute({
      request: request("/api/insight-groups", "POST", {
        title: ` ${group.title} `,
        guiding_question: ` ${group.guiding_question} `,
      }),
      env,
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).id, 7);

    const listed = await groupsRoute({ request: new Request("https://dashboard.example/api/insight-groups?limit=1000&offset=0"), env });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { items: [group], total: 1, limit: 1000, offset: 0 });
  });
});

test("問いグループの入力と送信元を検証する", async () => {
  await withFetch(() => { throw new Error("invalid request must not access DB"); }, async () => {
    const base = "/api/insight-groups";
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "", guiding_question: "  " }), env })).status, 400);
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "a".repeat(121), guiding_question: "問い" }), env })).status, 400);
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "題", guiding_question: "a".repeat(301) }), env })).status, 400);
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "題", guiding_question: "問い", extra: true }), env })).status, 400);
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "題", guiding_question: "問い" }, { Origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await groupsRoute({ request: request(base, "POST", { title: "題", guiding_question: "問い" }, { "X-Dashboard-Action": "knowledge-insight" }), env })).status, 403);
  });
});

test("問いグループの編集・削除は更新時刻で競合を検出する", async () => {
  const writes: Array<{ method: string | undefined; params: URLSearchParams }> = [];
  await withFetch((url, init) => {
    writes.push({ method: init?.method, params: url.searchParams });
    if (init?.method === "PATCH" || init?.method === "DELETE") return Response.json([]);
    return Response.json([{ id: group.id }]);
  }, async () => {
    const edited = await groupRoute({
      request: request("/api/insight-groups/7", "PATCH", {
        title: group.title,
        guiding_question: "次の問い",
        expected_updated_at: timestamp,
      }),
      params: { id: "7" },
      env,
    });
    assert.equal(edited.status, 409);
    const removed = await groupRoute({
      request: request("/api/insight-groups/7", "DELETE", { expected_updated_at: timestamp }),
      params: { id: "7" },
      env,
    });
    assert.equal(removed.status, 409);
    assert.deepEqual(writes.filter((item) => item.method === "PATCH" || item.method === "DELETE").map((item) => item.params.get("updated_at")), [
      `eq.${timestamp}`, `eq.${timestamp}`,
    ]);
  });
});

test("問いグループを削除しても示唆本文への削除要求はしない", async () => {
  await withFetch((url, init) => {
    assert.equal(url.pathname, "/rest/v1/insight_groups");
    assert.equal(init?.method, "DELETE");
    return Response.json([{ id: group.id }]);
  }, async () => {
    const removed = await groupRoute({
      request: request("/api/insight-groups/7", "DELETE", { expected_updated_at: timestamp }),
      params: { id: "7" },
      env,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { id: 7 });
  });
});

test("示唆の所属は重複を避けて追加し、正しい組だけを解除する", async () => {
  let existing = false;
  let insertCount = 0;
  await withFetch((url, init) => {
    if (url.pathname.endsWith("/insight_groups")) return Response.json([{ id: 7 }]);
    if (url.pathname.endsWith("/knowledge_insights")) return Response.json([{ id: 11 }]);
    if (url.pathname.endsWith("/insight_group_members")) {
      if (init?.method === "POST") {
        insertCount += 1;
        assert.deepEqual(JSON.parse(String(init.body)), member);
        assert.equal((init.headers as Record<string, string>).Prefer, "return=representation,resolution=ignore-duplicates");
        assert.equal(url.searchParams.get("on_conflict"), "group_id,insight_id");
        existing = true;
        return Response.json([member], { status: 201 });
      }
      if (init?.method === "DELETE") {
        assert.equal(url.searchParams.get("group_id"), "eq.7");
        assert.equal(url.searchParams.get("insight_id"), "eq.11");
        return Response.json([member]);
      }
      return Response.json(existing ? [member] : []);
    }
    throw new Error(`Unexpected ${url}`);
  }, async () => {
    const first = await membersRoute({ request: request("/api/insight-group-members", "POST", member), env });
    assert.equal(first.status, 201);
    const second = await membersRoute({ request: request("/api/insight-group-members", "POST", member), env });
    assert.equal(second.status, 200);
    assert.equal(insertCount, 1);
    const deleted = await membersRoute({ request: request("/api/insight-group-members", "DELETE", member), env });
    assert.equal(deleted.status, 200);
  });
});

test("同時に所属が追加されても、重複を成功として扱う", async () => {
  await withFetch((url, init) => {
    if (url.pathname.endsWith("/insight_groups")) return Response.json([{ id: 7 }]);
    if (url.pathname.endsWith("/knowledge_insights")) return Response.json([{ id: 11 }]);
    if (url.pathname.endsWith("/insight_group_members")) {
      if (init?.method === "POST") {
        assert.equal((init.headers as Record<string, string>).Prefer, "return=representation,resolution=ignore-duplicates");
        assert.equal(url.searchParams.get("on_conflict"), "group_id,insight_id");
        return Response.json([], { status: 201 });
      }
      return Response.json([]);
    }
    throw new Error(`Unexpected ${url}`);
  }, async () => {
    const response = await membersRoute({ request: request("/api/insight-group-members", "POST", member), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), member);
  });
});

test("存在しない示唆はグループに追加しない", async () => {
  await withFetch((url, init) => {
    assert.notEqual(init?.method, "POST");
    return Response.json(url.pathname.endsWith("/insight_groups") ? [{ id: 7 }] : []);
  }, async () => {
    const response = await membersRoute({ request: request("/api/insight-group-members", "POST", member), env });
    assert.equal(response.status, 404);
  });
});

test("API応答でグループと所属のIDを厳密に検証する", () => {
  assert.deepEqual(parseInsightGroup(group), group);
  assert.deepEqual(parseInsightGroupMember(member), member);
  assert.throws(() => parseInsightGroup({ ...group, id: 1.5 }), /id/);
  assert.throws(() => parseInsightGroupMember({ ...member, insight_id: 0 }), /insight_id/);
});

test("DBは示唆本文を複製せず、所属だけをcascade削除する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260925100000_insight_groups.sql", import.meta.url), "utf8");
  assert.match(sql, /insight_id bigint not null references public\.knowledge_insights\(id\) on delete cascade/);
  assert.match(sql, /group_id bigint not null references public\.insight_groups\(id\) on delete cascade/);
  assert.match(sql, /primary key \(group_id, insight_id\)/);
  assert.match(sql, /revoke all on table public\.insight_groups, public\.insight_group_members from public, anon, authenticated/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.match(sql, /values \('knowledge-dashboard', '20260925100000_insight_groups', now\(\)\)/);
  assert.doesNotMatch(sql, /\b(?:update|insert into|delete from)\s+public\.(?:quiz_log|knowledge)\b/i);
});

test("問いの名前は任意で、空なら問い文から付ける", async () => {
  assert.equal(deriveQuestionTitle("失敗を改善につなげるには？"), "失敗を改善につなげるには");
  assert.equal(deriveQuestionTitle("  どう  話す?? "), "どう 話す");
  assert.equal(deriveQuestionTitle("あ".repeat(60)), `${"あ".repeat(39)}…`);
  await withFetch((_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { title: "失敗を改善につなげるには", guiding_question: "失敗を改善につなげるには？" });
    return Response.json([group], { status: 201 });
  }, async () => {
    const created = await groupsRoute({ request: request("/api/insight-groups", "POST", { title: " ", guiding_question: "失敗を改善につなげるには？" }), env });
    assert.equal(created.status, 201);
  });
});

const material = {
  source_type: "insight", source_id: "11", title: "クローズドループ現象", body: "失敗を公開する",
  meta: "示唆", knowledge_id: "11111111-1111-4111-8111-111111111111", entry_date: null, similarity: 0.74,
};

test("問いの材料は、問い文が変わったときだけembeddingを作り直して返す", async () => {
  const calls: string[] = [];
  const voyage: unknown[] = [];
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  await withFetch(async (url, init) => {
    if (url.hostname === "api.voyageai.com") {
      voyage.push(JSON.parse(String(init?.body)));
      return Response.json({ data: [{ index: 0, embedding: vector }], usage: { total_tokens: 5 } });
    }
    const name = url.pathname.replace("/rest/v1/rpc/", "");
    calls.push(name);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (name === "question_material_state") {
      return Response.json([{ group_id: 7, guiding_question: "失敗を改善につなげるには？", input_hash: "h1", needs_embedding: calls.filter((c) => c === name).length === 1 }]);
    }
    if (name === "save_question_embedding") {
      assert.equal(body.p_input_hash, "h1");
      assert.equal(JSON.parse(String(body.p_embedding)).length, 1024);
      return Response.json(true);
    }
    if (name === "list_question_materials") {
      assert.deepEqual({ group: body.p_group_id, per: body.p_per_type, model: body.p_model }, { group: 7, per: 8, model: "voyage-4" });
      return Response.json([material]);
    }
    if (name === "list_question_exclusions") return Response.json([]);
    throw new Error(`unexpected ${name}`);
  }, async () => {
    const env2 = { ...env, VOYAGE_API_KEY: "key" };
    const first = await materialsRoute({ request: new Request("https://dashboard.example/api/insight-groups/7/materials"), params: { id: "7" }, env: env2 });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.deepEqual(parseQuestionMaterials(body).materials[0].source_id, "11");
    assert.equal(body.note, null);
    assert.equal((voyage[0] as { input_type: string }).input_type, "query");
    await materialsRoute({ request: new Request("https://dashboard.example/api/insight-groups/7/materials"), params: { id: "7" }, env: env2 });
    assert.equal(voyage.length, 1);
    assert.equal(calls.filter((c) => c === "save_question_embedding").length, 1);
  });
});

test("問いの材料はキーが無ければ集めずに理由を返し、外す・戻すは検証して記録する", async () => {
  const writes: Array<{ method?: string; url: URL; body: unknown }> = [];
  await withFetch((url, init) => {
    if (url.pathname.endsWith("/question_material_state")) {
      return Response.json([{ group_id: 7, guiding_question: "問い", input_hash: "h", needs_embedding: true }]);
    }
    if (url.pathname.endsWith("/list_question_exclusions")) return Response.json([]);
    if (url.pathname === "/rest/v1/question_material_exclusions") {
      writes.push({ method: init?.method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json([{ group_id: 7 }]);
    }
    throw new Error(`unexpected ${url.pathname}`);
  }, async () => {
    const noKey = await materialsRoute({ request: new Request("https://dashboard.example/api/insight-groups/7/materials"), params: { id: "7" }, env });
    const body = await noKey.json() as { materials: unknown[]; note: string };
    assert.deepEqual(body.materials, []);
    assert.match(body.note, /VOYAGE_API_KEY/);

    const path = "/api/insight-groups/7/materials";
    const excluded = await materialsRoute({ request: request(path, "POST", { action: "exclude", source_type: "journal", source_id: "2026-10-04" }), params: { id: "7" }, env });
    assert.equal(excluded.status, 200);
    assert.deepEqual(writes[0].body, { group_id: 7, source_type: "journal", source_id: "2026-10-04" });
    assert.equal(writes[0].url.searchParams.get("on_conflict"), "group_id,source_type,source_id");
    const restored = await materialsRoute({ request: request(path, "POST", { action: "restore", source_type: "journal", source_id: "2026-10-04" }), params: { id: "7" }, env });
    assert.equal(restored.status, 200);
    assert.equal(writes[1].method, "DELETE");
    assert.equal(writes[1].url.searchParams.get("source_id"), "eq.2026-10-04");

    assert.equal((await materialsRoute({ request: request(path, "POST", { action: "drop", source_type: "journal", source_id: "x" }), params: { id: "7" }, env })).status, 400);
    assert.equal((await materialsRoute({ request: request(path, "POST", { action: "exclude", source_type: "wants", source_id: "1" }), params: { id: "7" }, env })).status, 400);
    assert.equal((await materialsRoute({ request: request(path, "POST", { action: "exclude", source_type: "insight", source_id: "1" }, { "X-Dashboard-Action": "x" }), params: { id: "7" }, env })).status, 403);
    assert.equal(writes.length, 2);
  });
});

test("問いの材料のマイグレーションは、外したものと自分で入れた示唆をAIの一覧から外す", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261006100000_question_materials.sql", import.meta.url), "utf8");
  assert.match(sql, /question_material_exclusions x\s+where x\.group_id = p_group_id/);
  assert.match(sql, /insight_group_members m\s+where m\.group_id = p_group_id/);
  assert.match(sql, /references public\.insight_groups\(id\) on delete cascade/);
  for (const fn of ["question_material_state(bigint, text)", "save_question_embedding(bigint, text, text, text)",
    "list_question_materials(bigint, text, integer)", "list_question_exclusions(bigint)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
});
