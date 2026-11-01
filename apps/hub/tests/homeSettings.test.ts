import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHidden } from "../functions/_shared/homeSettings.ts";
import { onRequest } from "../functions/api/home-settings.ts";

const env = { SUPABASE_URL: "https://compass.supabase.co", SUPABASE_SECRET_KEY: "server-secret" };

function put(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/home-settings", {
    method: "PUT",
    headers: {
      Origin: "https://hub.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "home-settings-update",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("normalizeHidden keeps only known sections in display order", () => {
  assert.deepEqual(normalizeHidden(["journal", "bogus", "apps", "apps"]), ["apps", "journal"]);
  assert.deepEqual(normalizeHidden(null), []);
});

test("PUT rejects unknown sections, missing header and foreign origin", async () => {
  assert.equal((await onRequest({ request: put({ hidden: ["nope"] }), env })).status, 400);
  assert.equal((await onRequest({ request: put({ hidden: [] }, { "X-Dashboard-Action": "x" }), env })).status, 403);
  assert.equal((await onRequest({ request: put({ hidden: [] }, { Origin: "https://evil.example" }), env })).status, 403);
});

test("PUT saves and GET reads hidden sections", async (t) => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined });
    return init?.method === "POST"
      ? Response.json([{ hidden_sections: ["journal"] }])
      : Response.json([{ hidden_sections: ["journal", "data"] }]);
  });
  const saved = await onRequest({ request: put({ hidden: ["data", "journal"] }), env });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { hidden: ["journal", "data"] });
  assert.deepEqual(JSON.parse(calls[0].body as string).hidden_sections, ["journal", "data"]);
  const read = await onRequest({ request: new Request("https://hub.example/api/home-settings"), env });
  assert.deepEqual(await read.json(), { hidden: ["journal", "data"] });
});
