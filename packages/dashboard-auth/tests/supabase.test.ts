import assert from "node:assert/strict";
import test from "node:test";
import { fetchSupabase } from "../src/supabase.ts";

const endpoint = new URL("https://project.supabase.co/rest/v1/projects");

test("expired or invalid JWT claims are not retried even with a PGRST303 header", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const message of ["JWT expired", "JWT not in audience", "Parsing claims failed"]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return Response.json({ code: "PGRST303", message }, {
          status: 401,
          headers: { "Proxy-Status": "PostgREST; error=PGRST303" },
        });
      };
      const response = await fetchSupabase(endpoint, {});
      assert.equal(response.status, 401);
      assert.equal(calls, 1, message);
      assert.equal((await response.json()).message, message);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("permission errors and unrecognized authentication responses are not retried", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const errors = [
      () => Response.json({ code: "42501", message: "permission denied" }, { status: 403 }),
      () => Response.json({ code: "PGRST301", message: "Invalid JWT" }, { status: 401 }),
      () => new Response("Unauthorized", {
        status: 401,
        headers: { "Proxy-Status": "PostgREST; error=PGRST303" },
      }),
    ];
    for (const error of errors) {
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return error(); };
      const response = await fetchSupabase(endpoint, {});
      assert.equal(response.ok, false);
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
