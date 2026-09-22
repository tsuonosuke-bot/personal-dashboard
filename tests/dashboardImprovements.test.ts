import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadConnectionStatus } from "../functions/_shared/connectionStatus.ts";
import { onRequest as snapshotRoute } from "../functions/api/export/snapshot.ts";
// @ts-expect-error The browser helper is intentionally plain JavaScript.
import { readApiJson } from "../public/api-client.js";

const serviceToken = "hub-service-token-that-is-at-least-32-characters";
const env = {
  SUPABASE_URL: "https://personal-db.example",
  SUPABASE_SECRET_KEY: "server-secret-key",
  HUB_SERVICE_TOKEN: serviceToken,
  NAV_KNOWLEDGE_URL: "https://knowledge.example/",
  NAV_FINANCIAL_URL: "https://finance.example/",
};

test("API clientはHTMLと壊れたJSONを利用者向けエラーへ変換する", async () => {
  await assert.rejects(
    () => readApiJson(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })),
    (error: unknown) => error instanceof Error && /想定外の応答/.test(error.message) && !/Unexpected token/.test(error.message),
  );
  await assert.rejects(
    () => readApiJson(new Response("{broken", { headers: { "Content-Type": "application/json" } })),
    (error: unknown) => error instanceof Error && /想定外の応答/.test(error.message) && !/JSON|position|token/i.test(error.message),
  );
});

test("Hubは4つの直接追加と3種類の書き出しと接続状態を案内する", async () => {
  const [html, compass, projects, migration] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609220005_connection_status.sql", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="quickAddMenu"/);
  assert.match(html, /\/compass\/\?new=inbox/);
  assert.match(html, /\/finance\/\?new=expense/);
  assert.match(html, /\/projects\/\?new=project/);
  assert.match(html, /\/knowledge\/\?view=quiz&amp;mode=daily/);
  assert.match(html, /\/knowledge\/api\/export/);
  assert.match(html, /\/finance\/api\/export/);
  assert.match(html, /\/api\/export\/snapshot/);
  assert.match(html, /\/status\//);
  assert.match(compass, /initialParameters\.get\("new"\) === "inbox"/);
  assert.match(projects, /openNewProjectOnLoad/);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});

test("全体スナップショットは個人・Knowledge・Financeを読み取り専用JSONで返す", async () => {
  const originalFetch = globalThis.fetch;
  const personalTables: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.host === "personal-db.example") {
      assert.equal(headers.get("apikey"), "server-secret-key");
      const pathParts = url.pathname.split("/");
      const table = pathParts[pathParts.length - 1] || "";
      personalTables.push(table);
      return Response.json([{ id: 1, table }]);
    }
    assert.equal(headers.get("X-Hub-Service"), serviceToken);
    if (url.host === "knowledge.example") return Response.json({ schemaVersion: "knowledge-export.v1", readOnly: true, knowledge: [] });
    if (url.host === "finance.example") return Response.json({ schemaVersion: "finance-export.v1", readOnly: true, expenses: [] });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await snapshotRoute({ request: new Request("https://hub.example/api/export/snapshot"), env });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Disposition") || "", /^attachment; filename="personal-hub-snapshot-/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const payload = await response.json() as Record<string, any>;
    assert.equal(payload.readOnly, true);
    assert.equal(payload.schemaVersion, "personal-hub-snapshot.v1");
    assert.equal(payload.knowledge.schemaVersion, "knowledge-export.v1");
    assert.equal(payload.finance.schemaVersion, "finance-export.v1");
    assert.equal(Object.prototype.hasOwnProperty.call(payload.personal, "integration_connections"), false);
    assert.deepEqual([...new Set(personalTables)].sort(), Object.keys(payload.personal).sort());
    assert.doesNotMatch(JSON.stringify(payload), /server-secret-key|hub-service-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("接続状態はmigration行がないサービスを成功扱いしない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.host === "personal-db.example") return Response.json([]);
    return Response.json({
      authMethod: "Basic認証 + 署名付きセッション",
      destination: url.host,
      migration: url.host === "knowledge.example" ? "knowledge-migration" : "finance-migration",
      lastSuccessAt: "2026-09-22T00:00:00.000Z",
    });
  };
  try {
    const payload = await loadConnectionStatus(env);
    assert.equal(payload.services[0].migration, "確認できません");
    assert.equal(payload.services[0].lastSuccessAt, null);
    assert.equal(payload.services[1].migration, "knowledge-migration");
    assert.equal(payload.services[2].migration, "finance-migration");
    assert.deepEqual(Object.keys(payload.services[0]).sort(), ["authMethod", "destination", "id", "lastSuccessAt", "migration", "name"].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});
