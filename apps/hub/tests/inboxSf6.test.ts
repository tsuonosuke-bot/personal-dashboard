import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as routeEndpoint } from "../functions/api/inbox-route.ts";
import { onRequest as sourceEndpoint } from "../functions/api/inbox-sf6-source.ts";
import { sf6SavePayload, validateSf6Fields } from "../functions/_shared/sf6.ts";
import { createSf6InboxFlow, inboxSf6Preset, parseSf6Entry, type InboxSf6Source } from "../public/sf6/inbox.js";
import { readSf6TextValue } from "../public/sf6/text.js";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };
const key = "a1b2c3d4-1234-4abc-8def-1234567890ab";
const raw = "\n\n  メモ <script>😀</script>\r\n2行目\n\n";
const fields = { title: "練習", detail: raw, sequenceIds: [], status: "active", guardSetting: null, counterSetting: null, recoverySetting: null, reversalRecorded: false };
const body = (overrides: Record<string, unknown> = {}) => ({ inboxId: 7, exit: "sf6", params: { expected: { content: raw, result: null }, resource: "drills", fields }, idempotencyKey: key, ...overrides });
const request = (data: unknown) => new Request("https://dashboard.example/api/inbox-route", {
  method: "POST", headers: { Origin: "https://dashboard.example", "Content-Type": "application/json", "X-Dashboard-Action": "inbox-route" }, body: JSON.stringify(data),
});
const result = { contract: "inbox-route-v1", exit: "sf6", state: "completed", replayed: false, inbox: { id: 7, status: "done", result: "SF6の練習へ保存" }, want: null, route: null, project_id: null, sf6: { resource: "drills", id: 11, url: "/sf6/?resource=drills&id=11", deleted: false } };

test("SF6出口はFieldSpecで検証して共通の列変換を使い、単一RPCの保存済みIDを返す", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; args: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), args: JSON.parse(String(init?.body)) });
    return Response.json(result);
  };
  try {
    const response = await routeEndpoint({ request: request(body()), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
    assert.equal(calls.length, 1); // no separate SF6 write, Inbox PATCH, or fallible item GET
    assert.match(calls[0].url, /rpc\/route_inbox_sf6$/);
    const checked = validateSf6Fields("drills", fields); assert(checked.ok);
    assert.deepEqual(calls[0].args, { p_inbox_id: 7, p_params: { expected: { content: raw, result: null }, resource: "drills", payload: sf6SavePayload("drills", checked.value) }, p_idempotency_key: key });
    assert.equal((calls[0].args.p_params as { payload: { row: Record<string, unknown> } }).payload.row.detail, raw);
  } finally { globalThis.fetch = original; }
});

test("SF6出口はreadonly・legacy・未知キー・不足・別resourceをDB送信前に拒否する", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(result); };
  try {
    const base = body().params;
    const invalid = [
      { ...base, other: true }, { ...base, expected: { content: raw, result: null, other: true } },
      { ...base, expected: { content: raw } }, { ...base, resource: "matches" }, { ...base, resource: "__proto__" },
      { ...base, fields: { ...fields, presetKey: "preset" } }, { ...base, fields: { ...fields, comboId: 1 } },
      { ...base, fields: { ...fields, other: true } }, { ...base, fields: { ...fields, title: null } },
      { ...base, fields: { ...fields, detail: "x".repeat(2001) } }, { ...base, fields: { ...fields, sequenceIds: [1, 1] } },
    ];
    for (const params of invalid) assert.equal((await routeEndpoint({ request: request(body({ params })), env })).status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("SF6の参照・キャラ・重複エラーは入力を保ったまま直せる文言で返す", async () => {
  const original = globalThis.fetch;
  try {
    for (const [message, status, text] of [["SF6_SITUATION_CHARACTER", 400, "キャラ"], ["SF6_SITUATION_MISSING", 409, "参照先"], ["SF6_DUPLICATE", 409, "既に"]] as const) {
      globalThis.fetch = async () => Response.json({ message }, { status: 400 });
      const response = await routeEndpoint({ request: request(body()), env });
      assert.equal(response.status, status); assert.match((await response.json()).error, new RegExp(text));
    }
  } finally { globalThis.fetch = original; }
});

test("元Inboxと保存先の関連GETはID履歴で照合し、削除済みの双方も辿れる", async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url); assert.equal(init?.method, undefined);
    if (url.pathname.endsWith("inbox_sf6_routes")) return Response.json([{ inbox_id: null, source_inbox_id_snapshot: 7, resource: "drills", drill_id: null, situation_id: null, sequence_id: null, target_id_snapshot: 11, source_content: raw, source_result: null }]);
    return Response.json([]);
  };
  try {
    const response = await sourceEndpoint({ request: new Request("https://dashboard.example/api/inbox-sf6-source?resource=drills&targetId=11"), env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.inbox.content, raw); assert.equal(payload.inbox.status, "deleted"); assert.equal(payload.sf6.deleted, true);
    assert.equal(calls[0].searchParams.get("target_id_snapshot"), "eq.11");
    assert.equal(calls[1].searchParams.get("id"), "eq.7");
    assert.doesNotMatch(JSON.stringify(payload), /idempotency|request|test-secret/);
    assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  } finally { globalThis.fetch = original; }
});

test("元InboxのGETは任意URLや未知のresource・不正IDを受けない", async () => {
  for (const query of ["id=0", "id=9007199254740992", "id=7&url=https://example.com", "resource=matches&targetId=1", "resource=drills&targetId=-1"]) {
    assert.equal((await sourceEndpoint({ request: new Request(`https://dashboard.example/api/inbox-sf6-source?${query}`), env })).status, 400);
  }
});

test("初期候補は先頭の非空行だけ。全文・改行・HTML様文字列・絵文字を失わず保持する", () => {
  for (const resource of ["situations", "sequences", "drills"] as const) {
    const preset = inboxSf6Preset(resource, raw);
    assert.equal(preset[resource === "drills" ? "detail" : "memo"], raw);
    assert.equal(preset[resource === "situations" ? "name" : "title"], "メモ <script>😀</script>");
  }
  const long = "😀".repeat(2000);
  for (const [resource, limit] of [["situations", 60], ["sequences", 120], ["drills", 200]] as const) {
    const preset = inboxSf6Preset(resource, long);
    assert.equal([...(preset[resource === "situations" ? "name" : "title"] as string)].length, limit);
    assert.equal(preset[resource === "drills" ? "detail" : "memo"], long);
  }
  assert.equal(inboxSf6Preset("sequences", raw).notation, "");
  assert.equal(inboxSf6Preset("situations", raw).character, null);
});

test("本文は先頭末尾改行・CRLFまで保持し、名前等の通常のtrimは維持する", () => {
  assert.equal(readSf6TextValue(raw.replace(/\r\n/g, "\n"), raw, true), raw);
  assert.equal(readSf6TextValue("\n編集した本文\n", raw, true), "\n編集した本文\n");
  assert.equal(readSf6TextValue(" 名前 ", null), "名前");
  assert.equal(readSf6TextValue(" \n ", null, true), null);
  const checked = validateSf6Fields("drills", { ...fields, title: " 練習 " }); assert(checked.ok);
  assert.equal(checked.value.detail, raw); assert.equal(checked.value.title, "練習");
});

test("SF6 deep linkは許可された種類と正のIDだけ、元メモ本文を持たない", () => {
  assert.deepEqual(parseSf6Entry("https://example.com/sf6/?inbox=7&create=drills"), { type: "inbox", inboxId: 7, resource: "drills" });
  assert.deepEqual(parseSf6Entry("https://example.com/sf6/?resource=sequences&id=11"), { type: "target", resource: "sequences", id: 11 });
  assert.deepEqual(parseSf6Entry("https://example.com/sf6/?resource=__proto__&id=1"), { type: "invalid" });
  assert.equal(parseSf6Entry("https://example.com/sf6/?tab=frames"), null);
});

function flowFixture(loadResult = false) {
  let retry: (() => Promise<void>) | undefined;
  const status = { hidden: true, innerHTML: "", querySelector: () => status.innerHTML.includes("data-inbox-retry") ? { addEventListener: (_: string, callback: () => Promise<void>) => { retry = callback; } } : null };
  const context = { querySelector: () => null };
  const state = { editing: null, sequenceCharacter: "", sequenceKind: "", sequencePosition: "", situationCharacter: "", situationPosition: "", conditions: { situationId: null } };
  const opened: unknown[] = [];
  let closed = 0;
  const flow = createSf6InboxFlow({ state,
    els: { inboxStatus: status as unknown as HTMLElement, inboxContext: context as unknown as HTMLElement, inboxBoundary: {} as HTMLElement, saveButton: {} as HTMLButtonElement },
    openModal: (...args) => { opened.push(args); }, closeModal: () => { closed++; }, readDraft: () => ({}),
    load: async () => loadResult, selectTab: () => {}, find: () => ({ id: 11 }), render: () => {}, showToast: () => {},
  });
  return { flow, status, retry: () => retry?.(), opened, closed: () => closed };
}

test("保存成功後の再取得が失敗しても保存済みIDを保持し、再読込はPOSTしない", async () => {
  const original = globalThis.fetch;
  const oldHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  const replaced: string[] = [];
  Object.defineProperty(globalThis, "history", { configurable: true, value: { replaceState: (_: unknown, _title: string, url: string) => replaced.push(url) } });
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); return Response.json(result); };
  try {
    const fixture = flowFixture();
    await fixture.flow.save("drills", fields, { inbox: { id: 7, content: raw, result: null, status: "pending" } });
    assert.equal(fixture.closed(), 1); assert.deepEqual(replaced, [result.sf6.url]);
    assert.match(fixture.status.innerHTML, /保存は完了/); assert.match(fixture.status.innerHTML, /保存先を開く/);
    await fixture.retry(); assert.deepEqual(calls, ["/api/inbox-route"]);
    assert.equal(fixture.opened.length, 0);
  } finally {
    globalThis.fetch = original;
    if (oldHistory) Object.defineProperty(globalThis, "history", oldHistory); else Reflect.deleteProperty(globalThis, "history");
  }
});

test("応答取りこぼしの再試行は同じUUID、入力変更は最新snapshotと新UUIDを使う", async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (String(input).startsWith("/api/inbox-sf6-source")) return Response.json({ inbox: { id: 7, content: raw, result: null, status: "pending" }, sf6: null });
    keys.push(JSON.parse(String(init?.body)).idempotencyKey); throw new Error("response lost");
  };
  try {
    const fixture = flowFixture();
    const source: InboxSf6Source = { inbox: { id: 7, content: raw, result: null, status: "pending" } };
    await assert.rejects(fixture.flow.save("drills", fields, source), /response lost/);
    await assert.rejects(fixture.flow.save("drills", fields, source), /response lost/);
    await assert.rejects(fixture.flow.save("drills", { ...fields, title: "別内容" }, source), /response lost/);
    assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]); assert.match(calls[2], /inbox-sf6-source/);
    assert.equal(fixture.closed(), 0);
  } finally { globalThis.fetch = original; }
});
