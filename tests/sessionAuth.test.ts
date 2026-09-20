import assert from "node:assert/strict";
import test from "node:test";
import { acceptHandoff, acceptedDestination, createHandoffUrl } from "../functions/_shared/sessionAuth.ts";

const env = {
  SSO_SHARED_SECRET: "shared-secret-that-is-longer-than-thirty-two-characters",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function mockNonceConsumption(results: boolean[]) {
  const originalFetch = globalThis.fetch;
  const seenBodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/consume_dashboard_handoff_nonce$/);
    seenBodies.push(JSON.parse(String(init?.body)));
    return Response.json(results.shift() ?? false);
  };
  return { originalFetch, seenBodies };
}

test("Hub handoff opens the quiz setup after creating a session", async () => {
  const { originalFetch, seenBodies } = mockNonceConsumption([true]);
  try {
    const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
    assert.ok(handoffUrl);

    const accepted = await acceptHandoff(new Request(handoffUrl), env);
    assert.ok(accepted);
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get("Location"), "/?view=quiz");
    assert.match(accepted.headers.get("Set-Cookie") || "", /personal_hub_session=/);
    assert.equal(seenBodies.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hub handoff opens a validated knowledge record after creating a session", async () => {
  const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
  const { originalFetch } = mockNonceConsumption([true]);
  try {
    const handoffUrl = await createHandoffUrl(new URL(`https://knowledge.example/?knowledge=${knowledgeId}`), env);
    assert.ok(handoffUrl);

    const accepted = await acceptHandoff(new Request(handoffUrl), env);
    assert.ok(accepted);
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get("Location"), `/?knowledge=${knowledgeId}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hub handoff preserves the daily queue destination", async () => {
  const { originalFetch } = mockNonceConsumption([true]);
  try {
    const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz&mode=daily"), env);
    assert.ok(handoffUrl);
    const accepted = await acceptHandoff(new Request(handoffUrl), env);
    assert.equal(accepted?.headers.get("Location"), "/?view=quiz&mode=daily");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Handoff destination only accepts one known same-site parameter", () => {
  const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(acceptedDestination(`/?knowledge=${knowledgeId}`), `/?knowledge=${knowledgeId}`);
  assert.equal(acceptedDestination("/?view=quiz&mode=daily"), "/?view=quiz&mode=daily");
  assert.equal(acceptedDestination("/?view=quiz&mode=custom"), "/");
  assert.equal(acceptedDestination("/?knowledge=not-a-uuid"), "/");
  assert.equal(acceptedDestination(`/?knowledge=${knowledgeId}&view=quiz`), "/");
  assert.equal(acceptedDestination("//attacker.example/"), "/");
  assert.equal(acceptedDestination("https://attacker.example/"), "/");
});
test("Hub handoff falls back to the dashboard for an unknown destination", async () => {
  const { originalFetch } = mockNonceConsumption([true]);
  try {
    const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
    assert.ok(handoffUrl);
    handoffUrl.searchParams.set("next", "https://attacker.example/");

    const accepted = await acceptHandoff(new Request(handoffUrl), env);
    assert.ok(accepted);
    assert.equal(accepted.headers.get("Location"), "/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hub handoff token は一度しか受理しない", async () => {
  const { originalFetch } = mockNonceConsumption([true, false]);
  try {
    const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/"), env);
    assert.ok(handoffUrl);
    const first = await acceptHandoff(new Request(handoffUrl), env);
    const replay = await acceptHandoff(new Request(handoffUrl), env);
    assert.equal(first?.status, 302);
    assert.equal(replay?.status, 403);
    assert.match(await replay!.text(), /already been used/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
