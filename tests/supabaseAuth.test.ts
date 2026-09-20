import assert from "node:assert/strict";
import test from "node:test";
import { supabaseHeaders } from "../functions/_shared/supabaseAuth.ts";

test("uses current Supabase secret keys only as apikey headers", () => {
  assert.deepEqual(supabaseHeaders("sb_secret_example"), {
    Accept: "application/json",
    apikey: "sb_secret_example",
  });
});

test("adds bearer authorization for legacy service role JWTs", () => {
  const key = "eyJheader.payload.signature";
  assert.deepEqual(supabaseHeaders(key, { Prefer: "return=representation" }), {
    Accept: "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "return=representation",
  });
});
