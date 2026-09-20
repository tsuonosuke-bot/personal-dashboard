import assert from "node:assert/strict";
import test from "node:test";
import { acceptHandoff, createHandoffUrl } from "../functions/_shared/sessionAuth.ts";

const env = { SSO_SHARED_SECRET: "shared-secret-that-is-longer-than-thirty-two-characters" };

test("Hub handoff opens the quiz setup after creating a session", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
  assert.ok(handoffUrl);

  const accepted = await acceptHandoff(new Request(handoffUrl), env);
  assert.ok(accepted);
  assert.equal(accepted.status, 302);
  assert.equal(accepted.headers.get("Location"), "/?view=quiz");
  assert.match(accepted.headers.get("Set-Cookie") || "", /personal_hub_session=/);
});

test("Hub handoff falls back to the dashboard for an unknown destination", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
  assert.ok(handoffUrl);
  handoffUrl.searchParams.set("next", "https://attacker.example/");

  const accepted = await acceptHandoff(new Request(handoffUrl), env);
  assert.ok(accepted);
  assert.equal(accepted.headers.get("Location"), "/");
});
