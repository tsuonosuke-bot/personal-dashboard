import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptHandoff,
  createHandoffUrl,
  createNonceConsumer,
  hasValidSession,
  type NonceConsumer,
} from "../src/index.ts";

const env = { SSO_SHARED_SECRET: "shared-secret-that-is-longer-than-thirty-two-characters", SESSION_TTL_DAYS: "30" };
const accept = (consumeNonce: NonceConsumer | null, resolveDestination?: (next: string | null) => string) =>
  (request: Request) => acceptHandoff(request, env, { consumeNonce, resolveDestination });
const once = (): NonceConsumer => {
  const seen = new Set<string>();
  return async ({ nonce }) => (seen.has(nonce) ? false : (seen.add(nonce), true));
};

test("引き継ぎは遷移先のホストに結び付いた HttpOnly セッションを作る", async () => {
  const target = new URL("https://financial.example/");
  const handoffUrl = await createHandoffUrl(target, env);
  assert.ok(handoffUrl);
  assert.equal(handoffUrl.pathname, "/auth/handoff");

  const accepted = await accept(once())(new Request(handoffUrl));
  assert.equal(accepted?.status, 302);
  assert.equal(accepted?.headers.get("Location"), "/");
  const setCookie = accepted?.headers.get("Set-Cookie") || "";
  assert.match(setCookie, /personal_hub_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);

  const cookie = setCookie.split(";")[0];
  assert.equal(await hasValidSession(new Request(target, { headers: { Cookie: cookie } }), env), true);
  assert.equal(await hasValidSession(new Request("https://knowledge.example/", { headers: { Cookie: cookie } }), env), false);
  assert.equal(await hasValidSession(new Request(target, { headers: { Cookie: cookie } }), { SSO_SHARED_SECRET: "x".repeat(40) }), false);
});

test("改ざんしたトークンと別ホストでの利用は拒否する", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(handoffUrl);
  const token = handoffUrl.searchParams.get("token") || "";
  const tampered = new URL(handoffUrl);
  tampered.searchParams.set("token", `${token.startsWith("A") ? "B" : "A"}${token.slice(1)}`);
  assert.equal((await accept(once())(new Request(tampered)))?.status, 403);

  const wrongHost = new URL(handoffUrl);
  wrongHost.host = "knowledge.example";
  assert.equal((await accept(once())(new Request(wrongHost)))?.status, 403);
});

test("引き継ぎトークンは1回しか受理しない（再利用は403）", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(handoffUrl);
  const handler = accept(once());
  assert.equal((await handler(new Request(handoffUrl)))?.status, 302);
  const replay = await handler(new Request(handoffUrl));
  assert.equal(replay?.status, 403);
  assert.match(await replay!.text(), /already been used/);
});

test("nonceの消費がDBの失敗を返したら、その応答をそのまま返しセッションを作らない", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(handoffUrl);
  const response = await accept(async () => Response.json({ error: "DBの処理に失敗しました。" }, { status: 502 }))(new Request(handoffUrl));
  assert.equal(response?.status, 502);
  assert.equal(response?.headers.get("Set-Cookie"), null);
});

test("遷移先は resolveDestination が決め、省略すると常に / になる", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://knowledge.example/?view=quiz"), env);
  assert.ok(handoffUrl);
  assert.equal(handoffUrl.searchParams.get("next"), "/?view=quiz");
  assert.equal((await accept(null)(new Request(handoffUrl)))?.headers.get("Location"), "/");
  const resolved = await accept(null, (next) => (next === "/?view=quiz" ? "/?view=quiz" : "/"))(new Request(handoffUrl));
  assert.equal(resolved?.headers.get("Location"), "/?view=quiz");
});

test("consumeNonce が null のアプリ（Hub）は検証だけで受理する", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://hub.example/"), env);
  assert.ok(handoffUrl);
  assert.equal((await accept(null)(new Request(handoffUrl)))?.status, 302);
});

test("共有鍵が無い・短いときは引き継ぎを受け付けない", async () => {
  assert.equal(await createHandoffUrl(new URL("https://financial.example/"), {}), null);
  assert.equal(await createHandoffUrl(new URL("https://financial.example/"), { SSO_SHARED_SECRET: "short" }), null);
  const response = await acceptHandoff(new Request("https://financial.example/auth/handoff?token=x"), {}, { consumeNonce: null });
  assert.equal(response?.status, 503);
  assert.equal(await acceptHandoff(new Request("https://financial.example/other"), env, { consumeNonce: null }), null);
});

test("nonceの形が不正なトークンは拒否する", async () => {
  const handoffUrl = await createHandoffUrl(new URL("https://financial.example/"), env);
  assert.ok(handoffUrl);
  const [encoded] = (handoffUrl.searchParams.get("token") || "").split(".");
  const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
  assert.match(payload.nonce, /^[A-Za-z0-9_-]{20,64}$/);
  assert.equal(payload.exp - Math.floor(Date.now() / 1000) <= 60, true);
});

test("createNonceConsumer は consume_dashboard_handoff_nonce を呼び、結果とDB失敗を区別する", async () => {
  const originalFetch = globalThis.fetch;
  const dbEnv = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" };
  const calls: unknown[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /\/rest\/v1\/rpc\/consume_dashboard_handoff_nonce$/);
      assert.equal((init?.headers as Record<string, string>).apikey, "secret-test-key");
      calls.push(JSON.parse(String(init?.body)));
      return Response.json(calls.length === 1);
    };
    const consume = createNonceConsumer(dbEnv);
    assert.equal(await consume({ nonce: "n".repeat(22), exp: 1_900_000_000 }), true);
    assert.equal(await consume({ nonce: "n".repeat(22), exp: 1_900_000_000 }), false);
    assert.deepEqual(calls[0], { p_nonce: "n".repeat(22), p_expires_at: 1_900_000_000 });

    globalThis.fetch = async () => Response.json({ message: "boom" }, { status: 500 });
    const failed = await createNonceConsumer(dbEnv)({ nonce: "n".repeat(22), exp: 1 });
    assert.ok(failed instanceof Response);
    assert.equal(failed.status, 502);

    globalThis.fetch = async () => { throw new Error("network"); };
    assert.equal(((await createNonceConsumer(dbEnv)({ nonce: "n".repeat(22), exp: 1 })) as Response).status, 502);

    const notConfigured = await createNonceConsumer({})({ nonce: "n".repeat(22), exp: 1 });
    assert.equal((notConfigured as Response).status, 503);
    const insecure = await createNonceConsumer({ SUPABASE_URL: "http://project.supabase.co", SUPABASE_SECRET_KEY: "k" })({ nonce: "n".repeat(22), exp: 1 });
    assert.equal((insecure as Response).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
