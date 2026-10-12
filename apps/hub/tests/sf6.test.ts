import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toSf6Item, validateSf6Fields } from "../functions/_shared/sf6.ts";
import { onRequest as listRoute } from "../functions/api/sf6/index.ts";
import { onRequest as movesRoute } from "../functions/api/sf6/moves.ts";
import { onRequest as resourceRoute } from "../functions/api/sf6/[resource].ts";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "secret-test-key",
};
const STALE = "画面が古くなっています。ページを再読み込みしてください。";
const TIMESTAMP = "2026-10-12T00:00:00.123456+00:00";

const combo = {
  kind: "combo", character: "ケン", title: "中足ラッシュ", notation: "2中K > DR 5中P > 2強P xx 236強P", startup: 5,
  damage: 2860, driveCost: 1, saCost: 0, position: "anywhere", layering: null, aim: null, endPurpose: "oki",
  mastery: 1, memo: null, archived: false,
  starts: [1, { state: { advantage: 3, position: "anywhere", recovery: null } }],
  results: [{ kind: "hit", next: { state: { advantage: 31, position: "anywhere", recovery: "back_roll", name: "強昇龍締め後" } } }],
};
const setplay = {
  ...combo, kind: "setplay", title: "前ステ中P", notation: "前ステ 2中P 重ね", startup: null, damage: null, driveCost: 0,
  layering: "meaty", aim: "shimmy", endPurpose: null, starts: [5],
  results: [
    { kind: "opponent", opponentAction: "tech", outcome: "win", next: 9 },
    { kind: "opponent", opponentAction: "reversal", outcome: "lose" },
    { kind: "opponent", opponentAction: "jump", outcome: "unknown", next: null },
  ],
};
const sequenceRow = {
  id: 4, kind: "combo", character: "ケン", title: "中足ラッシュ", notation: "2中K > DR 5中P", startup: 5, damage: 2860,
  drive_cost: "1.0", sa_cost: 0, position: "anywhere", layering: null, aim: null, end_purpose: "oki", mastery: 1, memo: null,
  archived: false, created_at: TIMESTAMP, updated_at: TIMESTAMP,
  starts: [{ situation_id: 2 }, { situation_id: 1 }],
  results: [
    { kind: "opponent", opponent_action: "tech", outcome: "win", next_situation_id: null },
    { kind: "hit", opponent_action: null, outcome: null, next_situation_id: 12 },
    { kind: "opponent", opponent_action: "reversal", outcome: "lose", next_situation_id: 7 },
    { kind: "dance", opponent_action: null, outcome: null, next_situation_id: 1 },
  ],
};
const situationRow = {
  id: 1, character: null, kind: "trigger", name: "確定反撃", preset_key: "punish", advantage: null, position: "anywhere",
  recovery: null, memo: null, archived: false, created_at: TIMESTAMP, updated_at: TIMESTAMP,
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

/** RPCは保存した id、手順と状況の取り直しは1行ずつ返す。 */
function rpcBackend(rpcResponse: () => Response = () => Response.json(4)) {
  return withFetch((url) => {
    if (url.pathname.startsWith("/rest/v1/rpc/")) return rpcResponse();
    if (url.pathname.endsWith("sf6_sequences")) return Response.json([sequenceRow]);
    if (url.pathname.endsWith("sf6_situations")) return Response.json([situationRow]);
    return Response.json([]);
  });
}

async function call(method: string, resource: string, body: unknown) {
  return resourceRoute({ request: mutation(method, resource, body), env, params: { resource } });
}

test("手順の入力を検証し、空欄の任意項目はnullにする", () => {
  const result = validateSf6Fields("sequences", { ...combo, memo: "  ", title: "  中足ラッシュ " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.memo, null);
    assert.equal(result.value.title, "中足ラッシュ");
    assert.deepEqual(result.value.starts, [1, { state: { advantage: 3, position: "anywhere", recovery: null, name: null } }]);
  }
  assert.equal(validateSf6Fields("sequences", { ...combo, driveCost: 1.25 }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, startup: 0 }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, saCost: 5 }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, position: "air" }).ok, false);
  const { notation: _notation, ...missing } = combo;
  assert.equal(validateSf6Fields("sequences", missing).ok, false);
});

test("コンボと起き攻めの形（狙い・重ね方・締めの目的）を種類で確かめる", () => {
  assert.equal(validateSf6Fields("sequences", setplay).ok, true);
  const noAim = validateSf6Fields("sequences", { ...setplay, aim: null });
  assert.equal(noAim.ok, false);
  if (!noAim.ok) assert.match(noAim.error, /狙い/);
  assert.equal(validateSf6Fields("sequences", { ...setplay, endPurpose: "oki" }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, aim: "throw" }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, layering: "meaty" }).ok, false);
});

test("結果は重ならず、相手の行動は○×–が必須、ヒット・ガードは次の状況が必須。未確認で次もないものは保存しない", () => {
  const result = validateSf6Fields("sequences", setplay);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.results, [
      { kind: "opponent", opponentAction: "tech", outcome: "win", next: 9 },
      { kind: "opponent", opponentAction: "reversal", outcome: "lose", next: null },
    ]);
  }
  const twice = validateSf6Fields("sequences", { ...setplay, results: [setplay.results[0], setplay.results[0]] });
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.match(twice.error, /同じ結果/);
  assert.equal(validateSf6Fields("sequences", { ...setplay, results: [{ kind: "opponent", opponentAction: "tech", next: 3 }] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...setplay, results: [{ kind: "opponent", opponentAction: "dance", outcome: "win" }] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, results: [{ kind: "hit", next: null }] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, results: [{ kind: "hit", outcome: "win", next: 3 }] }).ok, false);
  // GETの形（nextSituationId）もそのまま受け付ける
  assert.equal(validateSf6Fields("sequences", { ...combo, results: [{ kind: "hit", opponentAction: null, outcome: null, nextSituationId: 12 }] }).ok, true);
});

test("始動の状況は追加では必須（1〜12件・重複なし）、編集で省けば子表を変えない", () => {
  const { starts: _starts, results: _results, ...parent } = combo;
  const created = validateSf6Fields("sequences", parent);
  assert.equal(created.ok, false);
  if (!created.ok) assert.match(created.error, /始動の状況/);
  const updated = validateSf6Fields("sequences", parent, "update");
  assert.equal(updated.ok, true);
  if (updated.ok) assert.equal("starts" in updated.value, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, starts: [] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, starts: [1, 1] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, starts: [{ state: { advantage: 400 } }] }).ok, false);
  assert.equal(validateSf6Fields("sequences", { ...combo, starts: [{ state: { advantage: 3, position: "air" } }] }).ok, false);
});

test("状況：きっかけは数値を持たず、局面はキャラと有利Fが必須。preset_key は読むだけ", () => {
  const trigger = { character: null, kind: "trigger", name: "昇龍ガード後", advantage: null, position: "anywhere", recovery: null, memo: null, archived: false };
  assert.equal(validateSf6Fields("situations", trigger).ok, true);
  assert.equal(validateSf6Fields("situations", { ...trigger, advantage: 3 }).ok, false);
  assert.equal(validateSf6Fields("situations", { ...trigger, position: "corner" }).ok, false);
  const stateValue = { ...trigger, kind: "state", character: "ケン", advantage: 29, position: "corner", recovery: "back_roll" };
  assert.equal(validateSf6Fields("situations", stateValue).ok, true);
  assert.equal(validateSf6Fields("situations", { ...stateValue, character: null }).ok, false);
  assert.equal(validateSf6Fields("situations", { ...stateValue, advantage: null }).ok, false);
  assert.deepEqual(toSf6Item("situations", situationRow), {
    id: 1, character: null, kind: "trigger", name: "確定反撃", presetKey: "punish", advantage: null, position: "anywhere",
    recovery: null, memo: null, archived: false, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
  });
});

test("練習記録の回数と成功数は両方そろえ、成功数は回数以下にする", () => {
  const log = { drillId: 3, practicedOn: "2026-10-11", attempts: 10, successes: 7, note: null };
  assert.equal(validateSf6Fields("logs", log).ok, true);
  assert.equal(validateSf6Fields("logs", { ...log, attempts: null, successes: null }).ok, true);
  assert.equal(validateSf6Fields("logs", { ...log, successes: null }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, successes: 11 }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, practicedOn: "2026-02-30" }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, drillId: null }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, attempts: 20, successes: 15, bestStreak: 16 }).ok, false);
});

test("練習メニューは手順の連なり（最大8件・重複なし）を持つ", () => {
  const drill = { title: "t", detail: null, sequenceIds: [3, 1], status: "active", guardSetting: "random", counterSetting: null, recoverySetting: null, reversalRecorded: false };
  assert.equal(validateSf6Fields("drills", drill).ok, true);
  assert.equal(validateSf6Fields("drills", { ...drill, sequenceIds: [] }).ok, true);
  assert.equal(validateSf6Fields("drills", { ...drill, sequenceIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).ok, false);
  assert.equal(validateSf6Fields("drills", { ...drill, guardSetting: "sometimes" }).ok, false);
});

test("DBの行をcamelCaseに直し、埋め込みの始動は数値の配列、結果は形を確かめて並べる", () => {
  assert.deepEqual(toSf6Item("matches", {
    id: 5, played_on: "2026-10-10", my_character: "ケン", opponent: "JP", result: "lose", mode: "ranked",
    good: "", bad: "端で暴れた", created_at: "2026-10-10T12:00:00+00:00", updated_at: "2026-10-10T12:00:00.123456+00:00",
  }), {
    id: 5, playedOn: "2026-10-10", myCharacter: "ケン", opponent: "JP", result: "lose", mode: "ranked",
    good: null, bad: "端で暴れた", createdAt: "2026-10-10T12:00:00+00:00", updatedAt: "2026-10-10T12:00:00.123456+00:00",
  });
  assert.equal(toSf6Item("matches", { id: "x" }), null);
  assert.equal("updatedAt" in (toSf6Item("logs", { id: 1, drill_id: 2 }) || {}), false);
  const item = toSf6Item("sequences", sequenceRow);
  assert.deepEqual(item?.starts, [2, 1]);
  assert.equal(item?.driveCost, 1);
  assert.deepEqual(item?.results, [
    { kind: "hit", opponentAction: null, outcome: null, nextSituationId: 12 },
    { kind: "opponent", opponentAction: "reversal", outcome: "lose", nextSituationId: 7 },
    { kind: "opponent", opponentAction: "tech", outcome: "win", nextSituationId: null },
  ]);
});

test("GETは状況・手順・練習・記録・振り返り・技データの版をまとめて返し、注意点や旧表は読まない", async () => {
  const mock = withFetch((url) => {
    const table = url.pathname.split("/").pop();
    if (table === "sf6_sequences") return Response.json([sequenceRow]);
    if (table === "sf6_move_sets") return Response.json([{ character: "ケン", data_version: "v1", source_url: "https://www.streetfighter.com/6/x", checked_on: "2026-10-12", move_count: 3, created_at: TIMESTAMP }]);
    return Response.json([]);
  });
  try {
    const response = await listRoute({ request: new Request("https://dashboard.example/api/sf6"), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["drills", "logs", "matches", "moveSets", "sequences", "situations", "source", "today"]);
    assert.deepEqual(body.sequences[0].starts, [2, 1]);
    assert.deepEqual(body.moveSets, [{ character: "ケン", dataVersion: "v1", sourceUrl: "https://www.streetfighter.com/6/x", checkedOn: "2026-10-12", moveCount: 3, createdAt: TIMESTAMP }]);
    assert.deepEqual(mock.calls.map((call) => call.url.pathname).sort(), [
      "/rest/v1/sf6_drill_logs", "/rest/v1/sf6_drills", "/rest/v1/sf6_matches", "/rest/v1/sf6_move_sets", "/rest/v1/sf6_sequences", "/rest/v1/sf6_situations",
    ]);
    const select = (table: string) => mock.calls.find((call) => call.url.pathname.endsWith(table))?.url.searchParams.get("select") || "";
    assert.match(select("sf6_sequences"), /starts:sf6_sequence_starts\(situation_id\),results:sf6_sequence_results\(kind,opponent_action,outcome,next_situation_id\)/);
    assert.equal(select("sf6_drill_logs").includes("updated_at"), false);
    assert.equal(select("sf6_move_sets").startsWith("id,"), false);
  } finally {
    mock.restore();
  }
});

test("POST sequences はRPCを1回呼び、列名の親・{state}つきの始動・結果を渡して、手順と状況を返す", async () => {
  const mock = rpcBackend();
  try {
    const response = await call("POST", "sequences", combo);
    assert.equal(response.status, 201);
    const rpcCall = mock.calls[0];
    assert.equal(rpcCall.url.pathname, "/rest/v1/rpc/sf6_save_sequence");
    assert.equal(new Headers(rpcCall.init.headers).get("Prefer"), null);
    const sent = JSON.parse(String(rpcCall.init.body));
    assert.equal(sent.p_id, null);
    assert.equal(sent.p_row.drive_cost, 1);
    assert.equal(sent.p_row.end_purpose, "oki");
    assert.equal("driveCost" in sent.p_row, false);
    assert.equal("starts" in sent.p_row, false);
    assert.deepEqual(sent.p_starts, [1, { state: { advantage: 3, position: "anywhere", recovery: null, name: null } }]);
    assert.deepEqual(sent.p_results, [{ kind: "hit", opponent_action: null, outcome: null, next: { state: { advantage: 31, position: "anywhere", recovery: "back_roll", name: "強昇龍締め後" } } }]);
    const body = await response.json();
    assert.equal(body.item.id, 4);
    assert.equal(body.situations[0].presetKey, "punish");
    assert.equal(mock.calls.find((call) => call.url.pathname.endsWith("sf6_sequences"))?.url.searchParams.get("id"), "eq.4");
  } finally {
    mock.restore();
  }
});

test("PATCH sequences は楽観ロックの競合を409にし、始動を省けば p_starts を null で送る。GETの形をそのまま送り返せる", async () => {
  let rpcResponse = () => Response.json({ code: "P0001", message: "SF6_CONFLICT" }, { status: 400 });
  const mock = rpcBackend(() => rpcResponse());
  try {
    const conflict = await call("PATCH", "sequences", { id: 4, updatedAt: TIMESTAMP, ...combo });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "他の画面で更新されています。再読み込みしてください。");
    const sent = JSON.parse(String(mock.calls[0].init.body));
    assert.deepEqual([sent.p_id, sent.p_updated_at], [4, TIMESTAMP]);

    rpcResponse = () => Response.json(4);
    const { starts: _starts, results: _results, ...parent } = combo;
    const partial = await call("PATCH", "sequences", { id: 4, updatedAt: TIMESTAMP, ...parent, mastery: 2 });
    assert.equal(partial.status, 200);
    const rpcCalls = mock.calls.filter((entry) => entry.url.pathname.startsWith("/rest/v1/rpc/"));
    const partialSent = JSON.parse(String(rpcCalls[rpcCalls.length - 1].init.body));
    assert.equal(partialSent.p_starts, null);
    assert.equal(partialSent.p_results, null);
    assert.equal(partialSent.p_row.mastery, 2);

    const { id, createdAt: _createdAt, updatedAt, ...fields } = toSf6Item("sequences", sequenceRow) as Record<string, unknown>;
    const roundTrip = await call("PATCH", "sequences", { id, updatedAt, ...fields });
    assert.equal(roundTrip.status, 200);
  } finally {
    mock.restore();
  }
});

test("RPCとPostgRESTのエラーを、状況・手順の文言に対応づける", async () => {
  const cases: Array<[Response, number, string]> = [
    [Response.json({ code: "P0001", message: "SF6_SITUATION_CHARACTER" }, { status: 400 }), 400, "別のキャラの状況は選べません。"],
    [Response.json({ code: "P0001", message: "SF6_STARTS_REQUIRED" }, { status: 400 }), 400, "始動の状況を1つ以上選んでください。"],
    [Response.json({ code: "P0001", message: "SF6_SITUATION_MISSING" }, { status: 400 }), 409, "参照している記録が削除されています。再読み込みしてください。"],
    [Response.json({ code: "23503", message: "fk" }, { status: 409 }), 409, "参照している記録が削除されています。再読み込みしてください。"],
  ];
  for (const [response, status, message] of cases) {
    const mock = rpcBackend(() => response);
    try {
      const result = await call("POST", "sequences", combo);
      assert.equal(result.status, status);
      assert.equal((await result.json()).error, message);
    } finally {
      mock.restore();
    }
  }
  // 状況のトリガー（D2・D3）
  const triggerCases: Array<[string, string, unknown, string]> = [
    ["PATCH", "SF6_SITUATION_IN_USE", { id: 5, updatedAt: TIMESTAMP, character: "リュウ", kind: "state", name: "x", advantage: 3, position: "anywhere", recovery: null, memo: null, archived: false }, "使っている手順があるため、キャラと種類は変えられません。"],
    ["DELETE", "SF6_PRESET_SITUATION", { id: 1 }, "初期の状況は削除できません。使わないときはアーカイブしてください。"],
  ];
  for (const [method, code, body, message] of triggerCases) {
    const mock = withFetch(() => Response.json({ code: "P0001", message: code }, { status: 400 }));
    try {
      const result = await call(method, "situations", body);
      assert.equal(result.status, 409);
      assert.equal((await result.json()).error, message);
    } finally {
      mock.restore();
    }
  }
  const duplicate = withFetch(() => Response.json({ code: "23505", message: "duplicate key value violates unique constraint \"sf6_situations_state_key\"" }, { status: 409 }));
  try {
    const result = await call("POST", "situations", { character: "ケン", kind: "state", name: "x", advantage: 3, position: "anywhere", recovery: null, memo: null, archived: false });
    assert.equal(result.status, 409);
    assert.equal((await result.json()).error, "同じ状況がすでにあります。");
  } finally {
    duplicate.restore();
  }
});

test("DELETE sequences は削除RPC（練習の連なりからも外す）を呼び、見つからなければ404", async () => {
  let rpcResponse = () => Response.json(4);
  const mock = rpcBackend(() => rpcResponse());
  try {
    const ok = await call("DELETE", "sequences", { id: 4 });
    assert.equal(ok.status, 200);
    assert.equal(mock.calls[0].url.pathname, "/rest/v1/rpc/sf6_delete_sequence");
    assert.deepEqual(JSON.parse(String(mock.calls[0].init.body)), { p_id: 4 });
    rpcResponse = () => Response.json({ code: "P0001", message: "SF6_NOT_FOUND" }, { status: 400 });
    const missing = await call("DELETE", "sequences", { id: 4 });
    assert.equal(missing.status, 404);
  } finally {
    mock.restore();
  }
});

test("注意点・旧コンボ・旧起き攻めは404で再読み込みを促し、古い練習の comboId は400で同じ文言", async () => {
  const mock = withFetch(() => Response.json([]));
  try {
    for (const resource of ["notes", "combos", "setplays"]) {
      for (const method of ["GET", "POST"]) {
        const response = await resourceRoute({
          request: new Request(`https://dashboard.example/api/sf6/${resource}`, { method }),
          env,
          params: { resource },
        });
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error, STALE);
      }
    }
    const drill = await call("POST", "drills", { title: "t", detail: null, comboId: 1, setplayId: null, status: "active" });
    assert.equal(drill.status, 400);
    assert.equal((await drill.json()).error, STALE);
    const moveSets = await call("POST", "moveSets", { character: "ケン" });
    assert.equal(moveSets.status, 404);
    assert.equal((await moveSets.json()).error, "見つかりませんでした。");
    const presetKey = await call("POST", "situations", { character: null, kind: "trigger", name: "x", presetKey: "punish", advantage: null, position: "anywhere", recovery: null, memo: null, archived: false });
    assert.equal(presetKey.status, 400);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("POSTは列名に直して登録し、別オリジンや操作ヘッダーなしは拒否する", async () => {
  const situation = { character: null, kind: "trigger", name: "昇龍ガード後", advantage: null, position: "anywhere", recovery: null, memo: null, archived: false };
  const mock = withFetch((_url, init) => {
    const row = JSON.parse(String(init.body));
    return Response.json([{ id: 9, ...row, preset_key: null, created_at: TIMESTAMP, updated_at: TIMESTAMP }], { status: 201 });
  });
  try {
    const response = await call("POST", "situations", situation);
    assert.equal(response.status, 201);
    const sent = JSON.parse(String(mock.calls[0].init.body));
    assert.equal(sent.name, "昇龍ガード後");
    assert.equal("preset_key" in sent, false);
    assert.equal((await response.json()).presetKey, null);

    const foreign = await resourceRoute({ request: mutation("POST", "situations", situation, { Origin: "https://evil.example" }), env, params: { resource: "situations" } });
    assert.equal(foreign.status, 403);
    const noAction = await resourceRoute({ request: mutation("POST", "situations", situation, { "X-Dashboard-Action": "habit-create" }), env, params: { resource: "situations" } });
    assert.equal(noAction.status, 403);
    const unknown = await call("POST", "users", situation);
    assert.equal(unknown.status, 404);
    const extra = await call("POST", "situations", { ...situation, id: 3 });
    assert.equal(extra.status, 400);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("PATCHはupdated_atで楽観ロックし、0件なら409を返す。練習記録は編集できない", async () => {
  const mock = withFetch(() => Response.json([]));
  try {
    const response = await call("PATCH", "matches", {
      id: 4, updatedAt: TIMESTAMP, playedOn: "2026-10-11", myCharacter: "ケン", opponent: "JP", result: "win", mode: "ranked", good: null, bad: null,
    });
    assert.equal(response.status, 409);
    const request = mock.calls[0];
    assert.equal(request.init.method, "PATCH");
    assert.equal(request.url.searchParams.get("id"), "eq.4");
    assert.equal(request.url.searchParams.get("updated_at"), `eq.${TIMESTAMP}`);

    const log = await call("PATCH", "logs", { id: 1, updatedAt: "2026-10-11T00:00:00Z", drillId: 1, practicedOn: "2026-10-11", attempts: null, successes: null, note: null });
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
    const ok = await call("DELETE", "logs", { id: 2 });
    assert.equal(ok.status, 200);
    assert.equal(new Headers(mock.calls[0].init.headers).get("Prefer"), "return=representation");
    rows = [];
    const missing = await call("DELETE", "situations", { id: 2 });
    assert.equal(missing.status, 404);
  } finally {
    mock.restore();
  }
});

test("GET /api/sf6/moves はキャラを検証し、登録のないキャラは set: null で返す", async () => {
  const moveRow = { id: 1, character: "ケン", sort_order: 1, category: "normal", name: "立ち弱P", command: "5弱P", hit_text: "+4", on_hit: 4, hit_knockdown: false };
  let registered = true;
  const mock = withFetch((url) => {
    if (url.pathname.endsWith("sf6_move_sets")) {
      return Response.json(registered ? [{ data_version: "v1", source_url: "https://www.streetfighter.com/6/x", checked_on: "2026-10-12" }] : []);
    }
    return Response.json(registered ? [moveRow] : []);
  });
  const get = (query: string, method = "GET") => movesRoute({ request: new Request(`https://dashboard.example/api/sf6/moves${query}`, { method }), env });
  try {
    assert.equal((await get("")).status, 400);
    assert.equal((await get(`?character=${"あ".repeat(41)}`)).status, 400);
    assert.equal((await get("?character=ケン", "POST")).status, 405);
    assert.equal(mock.calls.length, 0);
    const response = await get("?character=%E3%82%B1%E3%83%B3");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json();
    assert.deepEqual(body.set, { dataVersion: "v1", sourceUrl: "https://www.streetfighter.com/6/x", checkedOn: "2026-10-12" });
    assert.equal(body.moves[0].sortOrder, 1);
    assert.equal(body.moves[0].hitText, "+4");
    assert.equal(body.moves[0].punishCounterOverride, null);
    const movesCall = mock.calls.find((entry) => entry.url.pathname.endsWith("sf6_moves"));
    assert.equal(movesCall?.url.searchParams.get("character"), "eq.ケン");
    assert.equal(movesCall?.url.searchParams.get("order"), "sort_order.asc");
    registered = false;
    assert.deepEqual(await (await get("?character=リュウ")).json(), { character: "リュウ", set: null, moves: [] });
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
