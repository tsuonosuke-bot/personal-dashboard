import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as wantRoute } from "../functions/api/wants.ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

function request(action: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/wants", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": action,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("Inbox由来の内容をactive Wantとして登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: 51, content: "新しいWant", status: "active" }]);
  };
  try {
    const response = await wantRoute({
      request: request("want-create", { content: "  新しいWant  " }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(new URL(seenUrl).pathname, "/rest/v1/wants");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), { content: "新しいWant", status: "active", type: "want" });
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("寝かせるWantは再訪日とメモを一緒に登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seenInit = init;
    return Response.json([{ id: 52, content: "後で考える", status: "active" }]);
  };
  const revisitOn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const response = await wantRoute({
      request: request("want-create", { content: "後で考える", revisitOn, note: "  今は動かさない  ", sourceInboxId: 12 }),
      env,
    });
    assert.equal(response.status, 201);
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      content: "後で考える",
      status: "active",
      type: "want",
      revisit_on: revisitOn,
      note: "今は動かさない",
      source_inbox_id: 12,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("欲しいものはwish種別のactive Wantとして登録する", async () => {
  const originalFetch = globalThis.fetch;
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seenInit = init;
    return Response.json([{ id: 53, content: "新しいイヤホン", status: "active", type: "wish" }]);
  };
  try {
    const response = await wantRoute({
      request: request("want-create", { content: "新しいイヤホン", type: "wish", note: "軽いもの" }),
      env,
    });
    assert.equal(response.status, 201);
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      content: "新しいイヤホン",
      status: "active",
      type: "wish",
      note: "軽いもの",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wish種別のmigrationは既存のconcern種別を維持する", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202609220001_wants_wish_type.sql", import.meta.url), "utf8");
  assert.match(sql, /type in \('want', 'concern', 'wish'\)/i);
});

test("再訪日は日付形式と今日以降であることを検証する", async () => {
  const malformed = await wantRoute({
    request: request("want-create", { content: "後で考える", revisitOn: "2026/10/01" }),
    env,
  });
  assert.equal(malformed.status, 400);

  const past = await wantRoute({
    request: request("want-create", { content: "後で考える", revisitOn: "2020-01-01" }),
    env,
  });
  assert.equal(past.status, 400);

  const impossible = await wantRoute({
    request: request("want-create", { content: "後で考える", revisitOn: "2099-02-30" }),
    env,
  });
  assert.equal(impossible.status, 400);
});

test("不正なOrigin、余分な項目を拒否する", async () => {
  const wrongOrigin = await wantRoute({
    request: request("want-create", { content: "Want" }, { Origin: "https://attacker.example" }),
    env,
  });
  assert.equal(wrongOrigin.status, 403);

  const extraField = await wantRoute({
    request: request("want-create", { content: "Want", status: "active" }),
    env,
  });
  assert.equal(extraField.status, 400);

  const invalidType = await wantRoute({
    request: request("want-create", { content: "Want", type: "other" }),
    env,
  });
  assert.equal(invalidType.status, 400);
});
