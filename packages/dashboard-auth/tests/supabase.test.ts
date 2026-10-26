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

test("future-issued JWT rejection retries once with identical write body and preserves response metadata", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init!);
    return calls.length === 1
      ? Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 })
      : Response.json([{ id: 4 }], { status: 201, headers: { "Content-Range": "0-0/7" } });
  };
  try {
    const response = await fetchSupabase(endpoint, { method: "POST", body: '{"title":"keep"}', headers: { apikey: "sb_secret_test" } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body, calls[1].body);
    assert.equal(calls[0].signal, calls[1].signal);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Content-Range"), "0-0/7");
    assert.deepEqual(await response.json(), [{ id: 4 }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("the authentication retry stops after two responses and may be disabled by a caller", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 });
  };
  try {
    assert.equal((await fetchSupabase(endpoint, {})).status, 401);
    assert.equal(calls, 2);
    calls = 0;
    assert.equal((await fetchSupabase(endpoint, { method: "POST" }, { retryTransientAuth: false })).status, 401);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous writes and overload failures are never replayed or exposed through raw network errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [429, 500, 502, 503]) {
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return new Response("upstream detail", { status }); };
      assert.equal((await fetchSupabase(endpoint, { method: "POST", body: "{}" })).status, status);
      assert.equal(calls, 1);
    }
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error("https://secret-key@example.test/?apikey=secret-key"); };
    await assert.rejects(fetchSupabase(endpoint, { method: "PATCH", body: "{}" }), (error: Error) => {
      assert.equal(error.message, "Could not reach Supabase.");
      assert.equal("cause" in error, false);
      assert.doesNotMatch(String(error), /secret-key/);
      return true;
    });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("one deadline aborts stalled fetches and never retries a timed-out write", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("secret-key")), { once: true }));
  };
  try {
    await assert.rejects(fetchSupabase(endpoint, { method: "POST", body: "{}" }, { timeoutMs: 10 }), { message: "Supabase request timed out." });
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("the timeout covers a stalled response body and the authentication backoff", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) { init!.signal!.addEventListener("abort", () => controller.error(new Error("body stalled")), { once: true }); },
    }));
    await assert.rejects(fetchSupabase(endpoint, {}, { timeoutMs: 10 }), { message: "Supabase request timed out." });
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 }); };
    await assert.rejects(fetchSupabase(endpoint, {}, { timeoutMs: 10 }), { message: "Supabase request timed out." });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("credential policy keeps modern secrets out of bearer auth and respects explicit authorization", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = async (_input, init) => { seen.push(new Headers(init?.headers)); return new Response(null, { status: 204 }); };
  try {
    await fetchSupabase(endpoint, { headers: { apikey: "sb_secret_test" } });
    await fetchSupabase(endpoint, { headers: { apikey: "eyJtest.payload.signature" } });
    await fetchSupabase(endpoint, { headers: { apikey: "eyJtest.payload.signature", Authorization: "Bearer explicit" } });
    assert.equal(seen[0].get("Authorization"), null);
    assert.equal(seen[1].get("Authorization"), "Bearer eyJtest.payload.signature");
    assert.equal(seen[2].get("Authorization"), "Bearer explicit");
  } finally { globalThis.fetch = originalFetch; }
});

test("caller cancellation remains a sanitized single attempt", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("secret-key")), { once: true }));
  };
  try {
    const pending = fetchSupabase(endpoint, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { message: "Could not reach Supabase." });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
