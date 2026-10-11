import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toSf6Item, validateSf6Fields } from "../functions/_shared/sf6.ts";
import { onRequest as listRoute } from "../functions/api/sf6/index.ts";
import { onRequest as resourceRoute } from "../functions/api/sf6/[resource].ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};

const combo = {
  character: "ケン", title: "中足ラッシュ", notation: "2中K > DR 5中P > 2強P xx 236強P", position: "anywhere",
  damage: 2860, driveCost: 1, saCost: 0, mastery: 1, memo: null, archived: false,
};

function mutation(method: string, resource: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://dashboard.example/api/sf6/${resource}`, {
    method,
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "sf6",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function withFetch(handler: (url: URL, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("コンボの入力を検証し、空欄の任意項目はnullにする", () => {
  const result = validateSf6Fields("combos", { ...combo, memo: "  ", title: "  中足ラッシュ " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.memo, null);
    assert.equal(result.value.title, "中足ラッシュ");
  }
  assert.equal(validateSf6Fields("combos", { ...combo, driveCost: 7 }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...combo, mastery: 1.5 }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...combo, position: "air" }).ok, false);
  const { notation: _notation, ...missing } = combo;
  assert.equal(validateSf6Fields("combos", missing).ok, false);
});

test("対キャラの注意点だけ相手キャラを持つ", () => {
  const note = { category: "matchup", opponent: "JP", body: "トリグラフはパリィ", pinned: false, resolved: false };
  assert.equal(validateSf6Fields("notes", note).ok, true);
  const noOpponent = validateSf6Fields("notes", { ...note, opponent: "" });
  assert.equal(noOpponent.ok, false);
  if (!noOpponent.ok) assert.match(noOpponent.error, /相手キャラを入力/);
  assert.equal(validateSf6Fields("notes", { ...note, category: "self" }).ok, false);
  assert.equal(validateSf6Fields("notes", { ...note, category: "self", opponent: null }).ok, true);
});

test("練習記録の回数と成功数は両方そろえ、成功数は回数以下にする", () => {
  const log = { drillId: 3, practicedOn: "2026-10-11", attempts: 10, successes: 7, note: null };
  assert.equal(validateSf6Fields("logs", log).ok, true);
  assert.equal(validateSf6Fields("logs", { ...log, attempts: null, successes: null }).ok, true);
  assert.equal(validateSf6Fields("logs", { ...log, successes: null }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, successes: 11 }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, practicedOn: "2026-02-30" }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, drillId: null }).ok, false);
});

test("DBの行をcamelCaseに直し、壊れた行は捨てる", () => {
  assert.deepEqual(toSf6Item("matches", {
    id: 5, played_on: "2026-10-10", my_character: "ケン", opponent: "JP", result: "lose", mode: "ranked",
    good: "", bad: "端で暴れた", created_at: "2026-10-10T12:00:00+00:00", updated_at: "2026-10-10T12:00:00.123456+00:00",
  }), {
    id: 5, playedOn: "2026-10-10", myCharacter: "ケン", opponent: "JP", result: "lose", mode: "ranked",
    good: null, bad: "端で暴れた", createdAt: "2026-10-10T12:00:00+00:00", updatedAt: "2026-10-10T12:00:00.123456+00:00",
  });
  assert.equal(toSf6Item("matches", { id: "x" }), null);
  assert.equal("updatedAt" in (toSf6Item("logs", { id: 1, drill_id: 2 }) || {}), false);
});

test("GETは5つの表をまとめて返す", async () => {
  const mock = withFetch((url) => {
    const table = url.pathname.split("/").pop();
    const rows = table === "sf6_combos"
      ? [{ id: 1, character: "ケン", title: "t", notation: "n", position: "corner", damage: null, drive_cost: 0, sa_cost: 0, mastery: 2, memo: null, archived: false, created_at: "2026-10-11T00:00:00+00:00", updated_at: "2026-10-11T00:00:00+00:00" }]
      : [];
    return Response.json(rows);
  });
  try {
    const response = await listRoute({ request: new Request("https://dashboard.example/api/sf6"), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["combos", "drills", "logs", "matches", "notes", "source", "today"]);
    assert.equal(body.combos[0].mastery, 2);
    assert.deepEqual(mock.calls.map((call) => call.url.pathname).sort(), [
      "/rest/v1/sf6_combos", "/rest/v1/sf6_drill_logs", "/rest/v1/sf6_drills", "/rest/v1/sf6_matches", "/rest/v1/sf6_notes",
    ]);
    assert.equal(mock.calls.find((call) => call.url.pathname.endsWith("sf6_drill_logs"))?.url.searchParams.get("select")?.includes("updated_at"), false);
  } finally {
    mock.restore();
  }
});

test("POSTは列名に直して登録し、別オリジンや操作ヘッダーなしは拒否する", async () => {
  const mock = withFetch((_url, init) => {
    const row = JSON.parse(String(init.body));
    return Response.json([{ id: 9, ...row, created_at: "2026-10-11T00:00:00+00:00", updated_at: "2026-10-11T00:00:00+00:00" }], { status: 201 });
  });
  try {
    const response = await resourceRoute({ request: mutation("POST", "combos", combo), env, params: { resource: "combos" } });
    assert.equal(response.status, 201);
    const sent = JSON.parse(String(mock.calls[0].init.body));
    assert.equal(sent.drive_cost, 1);
    assert.equal(sent.sa_cost, 0);
    assert.equal("driveCost" in sent, false);
    assert.equal((await response.json()).driveCost, 1);

    const foreign = await resourceRoute({ request: mutation("POST", "combos", combo, { Origin: "https://evil.example" }), env, params: { resource: "combos" } });
    assert.equal(foreign.status, 403);
    const noAction = await resourceRoute({ request: mutation("POST", "combos", combo, { "X-Dashboard-Action": "habit-create" }), env, params: { resource: "combos" } });
    assert.equal(noAction.status, 403);
    const unknown = await resourceRoute({ request: mutation("POST", "users", combo), env, params: { resource: "users" } });
    assert.equal(unknown.status, 404);
    const extra = await resourceRoute({ request: mutation("POST", "combos", { ...combo, id: 3 }), env, params: { resource: "combos" } });
    assert.equal(extra.status, 400);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("PATCHはupdated_atで楽観ロックし、0件なら409を返す。練習記録は編集できない", async () => {
  const mock = withFetch(() => Response.json([]));
  try {
    const response = await resourceRoute({
      request: mutation("PATCH", "combos", { id: 4, updatedAt: "2026-10-11T00:00:00.123456+00:00", ...combo }),
      env,
      params: { resource: "combos" },
    });
    assert.equal(response.status, 409);
    const call = mock.calls[0];
    assert.equal(call.init.method, "PATCH");
    assert.equal(call.url.searchParams.get("id"), "eq.4");
    assert.equal(call.url.searchParams.get("updated_at"), "eq.2026-10-11T00:00:00.123456+00:00");

    const log = await resourceRoute({
      request: mutation("PATCH", "logs", { id: 1, updatedAt: "2026-10-11T00:00:00Z", drillId: 1, practicedOn: "2026-10-11", attempts: null, successes: null, note: null }),
      env,
      params: { resource: "logs" },
    });
    assert.equal(log.status, 405);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("DELETEは削除した行を返してもらい、見つからなければ404", async () => {
  let rows: unknown[] = [{ id: 2 }];
  const mock = withFetch(() => Response.json(rows));
  try {
    const ok = await resourceRoute({ request: mutation("DELETE", "logs", { id: 2 }), env, params: { resource: "logs" } });
    assert.equal(ok.status, 200);
    assert.equal(new Headers(mock.calls[0].init.headers).get("Prefer"), "return=representation");
    rows = [];
    const missing = await resourceRoute({ request: mutation("DELETE", "logs", { id: 2 }), env, params: { resource: "logs" } });
    assert.equal(missing.status, 404);
  } finally {
    mock.restore();
  }
});

test("SF6ページは共通ヘッダー・タブバー・テーマカラーを使う", async () => {
  const [html, css, shell, script, tabbar] = await Promise.all([
    readFile(new URL("../public/sf6/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/sf6.css", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard-shell.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sf6.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/tabbar.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<script src="\/theme\.js"><\/script>\s*<link rel="stylesheet" href="\/sf6\.css" \/>\s*<link rel="stylesheet" href="\/sf6\.dark\.css" \/>/);
  assert.match(html, /<span aria-current="page">SF6<\/span>/);
  assert.match(css, /--accent: #b3203d;/);
  assert.match(shell, /\.dashboard-brand-mark\.sf6 \{ background: #b3203d;/);
  assert.match(script, /"X-Dashboard-Action": "sf6"/);
  assert.match(tabbar, /\{ id: "sf6", label: "SF6", href: "\/sf6\/"/);
});
