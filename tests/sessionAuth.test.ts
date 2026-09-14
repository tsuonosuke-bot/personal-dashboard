import assert from "node:assert/strict";
import test from "node:test";
import { acceptHandoff, createHandoffUrl, hasValidSession } from "../functions/_shared/sessionAuth.ts";

const env = { SSO_SHARED_SECRET: "shared-secret-that-is-longer-than-thirty-two-characters", SESSION_TTL_DAYS: "30" };

test("handoff creates a host-bound HttpOnly session", async () => {
  const target = new URL("https://financial.example/");
  const handoffUrl = await createHandoffUrl(target, env);
  assert.ok(handoffUrl);

  const accepted = await acceptHandoff(new Request(handoffUrl), env);
  assert.ok(accepted);
  assert.equal(accepted.status, 302);
  assert.equal(accepted.headers.get("Location"), "/");
  const setCookie = accepted.headers.get("Set-Cookie") || "";
  assert.match(setCookie, /personal_hub_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = setCookie.split(";")[0];
  assert.equal(await hasValidSession(new Request(target, { headers: { Cookie: cookie } }), env), true);
  assert.equal(await hasValidSession(new Request("https://knowledge.example/", { headers: { Cookie: cookie } }), env), false);
});

test("handoff rejects tampering and the wrong target host", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(handoffUrl);
  const token = handoffUrl.searchParams.get("token") || "";
  handoffUrl.searchParams.set("token", `${token.slice(0, -1)}x`);
  assert.equal((await acceptHandoff(new Request(handoffUrl), env))?.status, 403);

  const correct = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(correct);
  const wrongHost = new URL(correct);
  wrongHost.host = "knowledge.example";
  assert.equal((await acceptHandoff(new Request(wrongHost), env))?.status, 403);
});
