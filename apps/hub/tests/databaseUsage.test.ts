import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadConnectionStatus } from "../functions/_shared/connectionStatus.ts";
import {
  DEFAULT_DB_LIMIT_MB,
  formatBytes,
  levelFor,
  limitMegabytes,
  loadDatabaseUsage,
  parseDatabaseUsage,
} from "../functions/_shared/databaseUsage.ts";
import { loadHub } from "../functions/_shared/hub.ts";

const MB = 1024 * 1024;
const row = (databaseMb: number) => ({
  database_bytes: databaseMb * MB,
  public_bytes: 6 * MB,
  top_tables: [{ name: "knowledge", bytes: 1.5 * MB }, { name: "quiz_log", bytes: MB }, { bad: true }],
});
const env = {
  SUPABASE_URL: "https://personal-db.example",
  SUPABASE_SECRET_KEY: "server-secret-key",
  HUB_SERVICE_TOKEN: "hub-service-token-that-is-at-least-32-characters",
  NAV_KNOWLEDGE_URL: "https://knowledge.example/",
  NAV_FINANCIAL_URL: "https://finance.example/",
};

test("使用率の段階は80%で注意、90%で逼迫", () => {
  assert.equal(levelFor(0.04), "ok");
  assert.equal(levelFor(0.79), "ok");
  assert.equal(levelFor(0.8), "warn");
  assert.equal(levelFor(0.9), "critical");
  assert.equal(levelFor(1.2), "critical");
});

test("上限は SUPABASE_DB_LIMIT_MB で変えられ、不正な値は無料プランの500MBに戻す", () => {
  assert.equal(DEFAULT_DB_LIMIT_MB, 500);
  assert.equal(limitMegabytes(undefined), 500);
  assert.equal(limitMegabytes("8192"), 8192);
  assert.equal(limitMegabytes(" 8192 "), 8192);
  for (const bad of ["", "abc", "0", "-5"]) assert.equal(limitMegabytes(bad), 500);
});

test("余裕があるうちは警告を出さず、注意・逼迫では使用量と上限を添えて出す", () => {
  const ok = parseDatabaseUsage(row(20), 500);
  assert.equal(ok?.level, "ok");
  assert.equal(ok?.alert, null);
  assert.equal(Math.round((ok?.ratio ?? 0) * 100), 4);
  assert.deepEqual(ok?.topTables, [{ name: "knowledge", bytes: 1.5 * MB }, { name: "quiz_log", bytes: MB }]);

  const warn = parseDatabaseUsage(row(420), 500);
  assert.equal(warn?.level, "warn");
  assert.match(warn!.alert!, /84%.*420 MB \/ 500 MB/);
  assert.doesNotMatch(warn!.alert!, /書き込めなく/);

  const critical = parseDatabaseUsage(row(470), 500);
  assert.equal(critical?.level, "critical");
  assert.match(critical!.alert!, /94%.*書き込めなくなります/);

  // プランを変えて上限を上げれば、同じ使用量でも警告は消える。
  assert.equal(parseDatabaseUsage(row(470), 8192)?.alert, null);
});

test("形が違う応答はnullにする", () => {
  assert.equal(parseDatabaseUsage(null, 500), null);
  assert.equal(parseDatabaseUsage([row(1)], 500), null);
  assert.equal(parseDatabaseUsage({ database_bytes: "20" }, 500), null);
  assert.equal(parseDatabaseUsage({ database_bytes: -1 }, 500), null);
});

test("バイト数はKB・MB・GBで読みやすく表示する", () => {
  assert.equal(formatBytes(512 * 1024), "512 KB");
  assert.equal(formatBytes(20.7 * MB), "20.7 MB");
  assert.equal(formatBytes(500 * MB), "500 MB");
  assert.equal(formatBytes(8 * 1024 * MB), "8.00 GB");
});

test("loadDatabaseUsage は get_database_usage を呼び、失敗してもnullで返す", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let seen: { url: string; key: string | undefined } | null = null;
    globalThis.fetch = async (input, init) => {
      seen = { url: String(input), key: (init?.headers as Record<string, string>).apikey };
      return Response.json(row(20));
    };
    const usage = await loadDatabaseUsage({ ...env, SUPABASE_DB_LIMIT_MB: "1000" });
    assert.equal(seen!.url, "https://personal-db.example/rest/v1/rpc/get_database_usage");
    assert.equal(seen!.key, "server-secret-key");
    assert.equal(usage?.limitBytes, 1000 * MB);

    globalThis.fetch = async () => Response.json({ message: "function not found" }, { status: 404 });
    assert.equal(await loadDatabaseUsage(env), null);
    globalThis.fetch = async () => { throw new Error("network"); };
    assert.equal(await loadDatabaseUsage(env), null);
    assert.equal(await loadDatabaseUsage({}), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("接続状態はPersonalのカードにDB容量を載せ、取得できなくても接続状態は成功のまま", async () => {
  const originalFetch = globalThis.fetch;
  const build = (usage: Response) => async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/get_database_usage")) return usage;
    if (url.host === "personal-db.example") return Response.json([{ migration: "personal" }]);
    return Response.json({ authMethod: "Basic", destination: url.host, migration: "m", lastSuccessAt: "2026-10-05T12:00:00Z" });
  };
  try {
    globalThis.fetch = build(Response.json(row(420)));
    const { services } = await loadConnectionStatus(env);
    assert.equal(services[0].databaseUsage?.level, "warn");
    assert.equal("databaseUsage" in services[1], false);

    globalThis.fetch = build(Response.json({ message: "nope" }, { status: 404 }));
    const missing = (await loadConnectionStatus(env)).services[0];
    assert.equal(missing.databaseUsage, null);
    assert.ok(missing.lastSuccessAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hubのトップは容量が逼迫したときだけ databaseAlert を載せる", async () => {
  const originalFetch = globalThis.fetch;
  const run = async (usage: Response) => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rpc/get_database_usage")) return usage.clone();
      if (url.pathname === "/api/review-queue/status") return Response.json({ ready_due: 1, waiting_grading: 0, grading_errors: 0, unconfirmed_results: 0, generation_held: 0 });
      return url.host.endsWith(".example") && url.host !== "personal-db.example"
        ? Response.json({ items: [], total: 0, limit: 1000, offset: 0 })
        : Response.json([]);
    };
    return (await loadHub(env, new Date("2026-10-05T12:00:00Z"))).summary.databaseAlert;
  };
  try {
    assert.equal(await run(Response.json(row(20))), null);
    assert.match(String(await run(Response.json(row(460)))), /92%/);
    assert.equal(await run(Response.json({ message: "x" }, { status: 404 })), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DB容量の関数は読み取り専用で、service_roleだけが実行できる。バナーとstatus画面が使う", async () => {
  const [sql, html, hubJs, statusJs] = await Promise.all([
    readFile(new URL("../supabase/migrations/202610050002_database_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/hub.js", import.meta.url), "utf8"),
    readFile(new URL("../public/status/status.js", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /revoke all on function public\.get_database_usage\(\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.get_database_usage\(\) to service_role;/);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from|drop table|truncate)\b/i);
  assert.match(html, /id="batchAlert"[^>]*hidden/);
  assert.match(hubJs, /summary\.databaseAlert/);
  assert.match(statusJs, /service\.id === "personal"[^\n]*usageRows\(service\.databaseUsage\)/);
});
