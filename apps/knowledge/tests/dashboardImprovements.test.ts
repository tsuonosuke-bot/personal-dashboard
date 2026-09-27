import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest as exportRoute } from "../functions/api/export.ts";
import { onRequest as statusRoute } from "../functions/api/status.ts";

const env = {
  SUPABASE_URL: "https://knowledge-db.example",
  SUPABASE_SECRET_KEY: "server-secret-key",
  AUTH_MODE: "basic",
};

test("Knowledge JSONは全ページ対象の読み取り専用添付を返す", async () => {
  const originalFetch = globalThis.fetch;
  const tables: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("apikey"), "server-secret-key");
    const table = url.pathname.split("/").at(-1) || "";
    tables.push(table);
    return Response.json([{ id: `${table}-1` }]);
  };
  try {
    const response = await exportRoute({ request: new Request("https://dashboard.example/api/export"), env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(response.headers.get("Content-Disposition") || "", /^attachment; filename="knowledge-export-/);
    const payload = await response.json() as Record<string, any>;
    assert.equal(payload.schemaVersion, "knowledge-export.v1");
    assert.equal(payload.readOnly, true);
    assert.deepEqual(tables.sort(), ["knowledge", "quiz_log", "speaking_practice_log"]);
    assert.equal(payload.knowledge[0].id, "knowledge-1");
    assert.doesNotMatch(JSON.stringify(payload), /server-secret-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Knowledge接続状態は要求された4項目だけを返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ migration: "20260922140000_connection_status" }]);
  try {
    const response = await statusRoute({ request: new Request("https://dashboard.example/api/status"), env });
    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["authMethod", "destination", "lastSuccessAt", "migration"].sort());
    assert.equal(payload.destination, "knowledge-db.example");
    assert.equal(payload.migration, "20260922140000_connection_status");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Knowledge画面はJSON・共通状態・グラフ要約を提供する", async () => {
  const [app, card, dashboard, trend, style, migration] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ChartCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DashboardCharts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/RegistrationTrendChart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260922140000_connection_status.sql", import.meta.url), "utf8"),
  ]);
  assert.match(app, /href="api\/export"/);
  assert.match(app, /personal-dashboard-7md\.pages\.dev\/status\//);
  assert.match(card, /role="img"/);
  assert.match(card, /aria-describedby/);
  assert.match(dashboard, /categorySummary/);
  assert.match(dashboard, /masterySummary/);
  assert.match(dashboard, /historySummary/);
  assert.match(trend, /registration-trend-summary/);
  assert.match(style, /\.chart-summary/);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});
