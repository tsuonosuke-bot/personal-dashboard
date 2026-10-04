import assert from "node:assert/strict";
import test from "node:test";
import { requestSupabaseFunction, requestSupabaseRows } from "../functions/_shared/supabaseRest.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };

/** Supabaseへの呼び出しを数え、用意した応答を順番に返す。 */
async function withSupabase(responses: (() => Response)[], run: (calls: () => number) => Promise<void>) {
  let count = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const next = responses[count++];
    if (!next) throw new Error("unexpected Supabase call");
    return next();
  };
  try {
    await run(() => count);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const jwtRejected = () => Response.json(
  { code: "PGRST303", details: null, hint: null, message: "JWT issued at future" },
  { status: 401, headers: { "Proxy-Status": "PostgREST; error=PGRST303" } },
);

test("同時リクエストでキーが一時的に拒否されたら（PGRST303）、1回だけやり直す", async () => {
  await withSupabase([jwtRejected, () => Response.json(42)], async (calls) => {
    const result = await requestSupabaseFunction(env, "begin_review_batch", { p_kind: "grade", p_trigger: "schedule" });
    assert.deepEqual(result, { ok: true, data: 42 });
    assert.equal(calls(), 2);
  });
  // ヘッダーが無くても本文のコードで判定する
  await withSupabase([
    () => Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 }),
    () => Response.json([{ id: 1 }]),
  ], async (calls) => {
    const result = await requestSupabaseRows(env, { table: "knowledge", params: new URLSearchParams() });
    assert.equal(result.ok, true);
    assert.equal(calls(), 2);
  });
});

test("やり直しは1回だけで、ほかの認証エラーはやり直さない", async () => {
  await withSupabase([jwtRejected, jwtRejected], async (calls) => {
    const result = await requestSupabaseFunction(env, "begin_review_batch", {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 502);
    assert.equal(calls(), 2);
  });
  await withSupabase([
    () => Response.json({ code: "42501", message: "permission denied for function" }, { status: 401 }),
  ], async (calls) => {
    const result = await requestSupabaseFunction(env, "begin_review_batch", {});
    assert.equal(result.ok, false);
    assert.equal(calls(), 1);
  });
});
