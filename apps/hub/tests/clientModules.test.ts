import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../public/shared/html.js";

// These browser modules deliberately have no DOM access at import time.
const clientModule = (path: string) => import(new URL(`../public/${path}.js`, import.meta.url).href);

test("shared HTML escaping protects both text and quoted attributes without losing Japanese", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')"> & リュウ`), "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp; リュウ");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml("豪鬼 🥋"), "豪鬼 🥋");
});

test("page requests retain the exact optimistic-update body and action headers", async () => {
  const { projectRequest } = await clientModule("projects/api");
  const { sf6Request } = await clientModule("sf6/api");
  const originalFetch = globalThis.fetch;
  const body = { id: 12, originalUpdatedAt: "2026-10-23T01:00:00Z", content: "次の一手" };
  const init = { method: "PATCH", headers: { "Content-Type": "application/json", "X-Dashboard-Action": "project-action-update" }, body: JSON.stringify(body) };
  try {
    for (const request of [projectRequest, sf6Request]) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, "/api/example");
        assert.equal(options, init);
        assert.deepEqual(JSON.parse(String(options?.body)), body);
        return Response.json({ saved: true });
      };
      assert.deepEqual(await request("/api/example", init, () => new Error("保存失敗")), { saved: true });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP conflict and authentication responses remain failures with their original messages", async () => {
  const { projectRequest } = await clientModule("projects/api");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ error: "別の画面で更新されました。" }, { status: 409 }); };
    await assert.rejects(projectRequest("/api/projects", {}, (p: { error: string }) => new Error(p.error)), /別の画面で更新/);
    assert.equal(calls, 1, "a conflict must not retry or overwrite automatically");
    globalThis.fetch = async () => new Response("<html>Sign in</html>", { status: 401, headers: { "Content-Type": "text/html" } });
    await assert.rejects(projectRequest("/api/projects", {}, () => new Error("保存失敗")), /認証の有効期限/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Today updates preserve same-origin access and the calendar conflict token", async () => {
  const { sendJson } = await clientModule("today/api");
  const originalFetch = globalThis.fetch;
  const body = { id: 4, command: "complete", originalUpdatedAt: "stamp", originalCalendarEtag: '"etag"' };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/scheduled-actions");
      assert.equal(init?.method, "PATCH");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("X-Dashboard-Action"), "scheduled-todo-update");
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      return Response.json({ ok: true });
    };
    await sendJson("/api/scheduled-actions", "PATCH", "scheduled-todo-update", body);
  } finally { globalThis.fetch = originalFetch; }
});

test("screen state is isolated and models can filter linked sources without a document", async () => {
  const { createProjectState } = await clientModule("projects/state");
  const { createSf6State } = await clientModule("sf6/state");
  const { createTodayState } = await clientModule("today/state");
  const { createProjectModel } = await clientModule("projects/model");
  for (const create of [createProjectState, createSf6State, createTodayState]) assert.notEqual(create(), create());
  const sf6 = createSf6State();
  sf6.moves.set("リュウ", {});
  sf6.conditions.drive = 3;
  assert.equal(createSf6State().moves.size, 0);
  assert.equal(createSf6State().conditions.drive, null);
  const state = createProjectState();
  const a = { id: 1, title: "英語", status: "active", needsAttention: false, actions: [{ content: "教材を選ぶ" }], items: [{ sourceContent: "発音を練習" }], targetOn: "2026-11-01", updatedAt: "2026-10-23" };
  const b = { ...a, id: 2, targetOn: null, needsAttention: true };
  state.data = { projects: [b, a] };
  const model = createProjectModel({ state });
  state.search = "発音";
  assert.deepEqual(model.projectsForView().map((p: { id: number }) => p.id), [2, 1]);
  state.attentionOnly = true;
  assert.equal(model.projectsForView().length, 1);
  assert.equal(model.sortProjects([b, a], "target")[0].id, 1);
  assert.equal(state.data.projects[0].id, 2, "sorting must not mutate the server's order");
  assert.equal(model.weekStartTokyo("2026-10-25"), "2026-10-19");
});

test("SF6 relative days use the server's Tokyo date after module separation", async () => {
  const { daysAgo } = await clientModule("sf6/format");
  assert.equal(daysAgo("2026-10-23", "2026-10-23"), "今日");
  assert.equal(daysAgo("2026-10-22", "2026-10-23"), "昨日");
  assert.equal(daysAgo("2026-10-20", "2026-10-23"), "3日前");
  assert.equal(daysAgo("2026-10-20", null), "");
});
