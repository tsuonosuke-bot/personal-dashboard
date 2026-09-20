import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as goRoute } from "../functions/go/[target].ts";
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
  handoffUrl.searchParams.set("token", `${token.startsWith("A") ? "B" : "A"}${token.slice(1)}`);
  assert.equal((await acceptHandoff(new Request(handoffUrl), env))?.status, 403);

  const correct = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(correct);
  const wrongHost = new URL(correct);
  wrongHost.host = "knowledge.example";
  assert.equal((await acceptHandoff(new Request(wrongHost), env))?.status, 403);
});

test("handoff preserves a same-site quiz destination", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
  assert.ok(handoffUrl);
  assert.equal(handoffUrl.origin, "https://knowledge.example");
  assert.equal(handoffUrl.pathname, "/auth/handoff");
  assert.equal(handoffUrl.searchParams.get("next"), "/?view=quiz");
});

test("Knowledge review shortcut creates a quiz handoff", async () => {
  const response = await goRoute({
    request: new Request("https://hub.example/go/knowledge?view=quiz"),
    env: { ...env, NAV_KNOWLEDGE_URL: "https://knowledge.example/custom/?tenant=owner" },
    params: { target: "knowledge" },
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location") || "https://invalid.example/");
  assert.equal(location.origin, "https://knowledge.example");
  assert.equal(location.pathname, "/auth/handoff");
  assert.equal(location.searchParams.get("next"), "/?view=quiz");
});

test("Knowledge card shortcut preserves a validated record destination through SSO", async () => {
  const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";
  const response = await goRoute({
    request: new Request(`https://hub.example/go/knowledge?knowledge=${knowledgeId}`),
    env: { ...env, NAV_KNOWLEDGE_URL: "https://knowledge.example/custom/?tenant=owner" },
    params: { target: "knowledge" },
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location") || "https://invalid.example/");
  assert.equal(location.origin, "https://knowledge.example");
  assert.equal(location.pathname, "/auth/handoff");
  assert.equal(location.searchParams.get("next"), `/?knowledge=${knowledgeId}`);
});

test("Knowledge card shortcut ignores an invalid record identifier", async () => {
  const response = await goRoute({
    request: new Request("https://hub.example/go/knowledge?knowledge=https://attacker.example/"),
    env: { AUTH_MODE: "access", NAV_KNOWLEDGE_URL: "https://knowledge.example/" },
    params: { target: "knowledge" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://knowledge.example/");
});

test("dashboard navigation falls back to the protected target without SSO", async () => {
  const response = await goRoute({
    request: new Request("https://hub.example/go/knowledge?view=quiz"),
    env: { NAV_KNOWLEDGE_URL: "https://knowledge.example/custom/" },
    params: { target: "knowledge" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://knowledge.example/?view=quiz");
});

test("Cloudflare Access navigation skips the Basic-auth handoff", async () => {
  const response = await goRoute({
    request: new Request("https://hub.example/go/knowledge?view=quiz"),
    env: { ...env, AUTH_MODE: "access", NAV_KNOWLEDGE_URL: "https://knowledge.example/" },
    params: { target: "knowledge" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://knowledge.example/?view=quiz");
});
