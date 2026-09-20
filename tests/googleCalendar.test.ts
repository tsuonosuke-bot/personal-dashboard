import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as callbackEndpoint } from "../functions/api/google-calendar-callback.ts";
import { onRequest as connectEndpoint } from "../functions/api/google-calendar-connect.ts";
import { onRequest as statusEndpoint } from "../functions/api/google-calendar-status.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-secret",
  GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

test("Google Calendar未設定時は外部通信せず接続不可を返す", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };
  try {
    const response = await statusEndpoint({
      request: new Request("https://dashboard.example/api/google-calendar-status"),
      env: {},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      configured: false,
      connected: false,
      calendarId: "primary",
      timeZone: "Asia/Tokyo",
      connectedAt: null,
    });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google OAuth開始は最小Calendar scope、PKCE、HttpOnly stateを使う", async () => {
  const response = await connectEndpoint({
    request: new Request("https://dashboard.example/api/google-calendar-connect"),
    env,
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location")!);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  assert.equal(location.searchParams.get("access_type"), "offline");
  assert.equal(location.searchParams.get("prompt"), "consent");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("code_challenge"));
  assert.equal(location.searchParams.get("redirect_uri"), "https://dashboard.example/api/google-calendar-callback");
  const cookie = response.headers.get("Set-Cookie") || "";
  assert.match(cookie, /^google_calendar_oauth_state=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, new RegExp(location.searchParams.get("state")!));
});

test("OAuth callbackはCalendar権限を検証し、refresh tokenを暗号化して保存する", async () => {
  const start = await connectEndpoint({
    request: new Request("https://dashboard.example/api/google-calendar-connect"),
    env,
  });
  const authorization = new URL(start.headers.get("Location")!);
  const state = authorization.searchParams.get("state")!;
  const cookie = (start.headers.get("Set-Cookie") || "").split(";")[0];
  const originalFetch = globalThis.fetch;
  let stored: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(init?.method, "POST");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("code"), "authorization-code");
      assert.ok(form.get("code_verifier"));
      return Response.json({
        access_token: "short-lived-access-token",
        refresh_token: "long-lived-refresh-token",
        scope: "https://www.googleapis.com/auth/calendar.events",
      });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/calendars/primary/events")) {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer short-lived-access-token");
      return Response.json({ kind: "calendar#events" });
    }
    if (url.hostname === "project.supabase.co" && url.pathname.endsWith("/integration_connections")) {
      stored = JSON.parse(String(init?.body));
      return Response.json([{ provider: "google_calendar" }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await callbackEndpoint({
      request: new Request(`https://dashboard.example/api/google-calendar-callback?state=${encodeURIComponent(state)}&code=authorization-code`, {
        headers: { Cookie: cookie },
      }),
      env,
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "https://dashboard.example/compass/?calendar=connected");
    assert.match(response.headers.get("Set-Cookie") || "", /Max-Age=0/);
    assert.ok(stored);
    const saved = stored as unknown as Record<string, unknown>;
    assert.equal(saved.provider, "google_calendar");
    assert.equal(saved.scope, "https://www.googleapis.com/auth/calendar.events");
    assert.equal(typeof saved.encrypted_credentials, "string");
    assert.doesNotMatch(String(saved.encrypted_credentials), /long-lived-refresh-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callbackはstate不一致を拒否し、token endpointを呼ばない", async () => {
  const start = await connectEndpoint({
    request: new Request("https://dashboard.example/api/google-calendar-connect"),
    env,
  });
  const cookie = (start.headers.get("Set-Cookie") || "").split(";")[0];
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const response = await callbackEndpoint({
      request: new Request("https://dashboard.example/api/google-calendar-callback?state=wrong&code=authorization-code", {
        headers: { Cookie: cookie },
      }),
      env,
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "https://dashboard.example/compass/?calendar=error");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuthのキャンセル応答もstate一致を必須とする", async () => {
  const start = await connectEndpoint({
    request: new Request("https://dashboard.example/api/google-calendar-connect"),
    env,
  });
  const authorization = new URL(start.headers.get("Location")!);
  const state = authorization.searchParams.get("state")!;
  const cookie = (start.headers.get("Set-Cookie") || "").split(";")[0];

  const denied = await callbackEndpoint({
    request: new Request(`https://dashboard.example/api/google-calendar-callback?error=access_denied&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: cookie },
    }),
    env,
  });
  assert.equal(denied.status, 302);
  assert.equal(denied.headers.get("Location"), "https://dashboard.example/compass/?calendar=denied");

  const invalid = await callbackEndpoint({
    request: new Request("https://dashboard.example/api/google-calendar-callback?error=access_denied&state=wrong", {
      headers: { Cookie: cookie },
    }),
    env,
  });
  assert.equal(invalid.status, 302);
  assert.equal(invalid.headers.get("Location"), "https://dashboard.example/compass/?calendar=error");
});
