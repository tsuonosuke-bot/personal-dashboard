import assert from "node:assert/strict";
import test from "node:test";
import { requestSupabaseFunction } from "../../hub/functions/knowledge/_shared/supabaseRest.ts";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };

test("戻り値がvoidのRPC（204・本文なし）は成功として扱い、接続エラーにしない", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    const result = await requestSupabaseFunction(env, "attach_review_generation_jobs", { p_run_id: 1 });
    assert.deepEqual(result, { ok: true, data: null });
  } finally {
    globalThis.fetch = original;
  }
});

test("本文があるRPCはJSONとして読む", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ a: 1 }]);
  try {
    const result = await requestSupabaseFunction(env, "x", {});
    assert.deepEqual(result, { ok: true, data: [{ a: 1 }] });
  } finally {
    globalThis.fetch = original;
  }
});
