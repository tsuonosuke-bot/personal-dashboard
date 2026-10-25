import assert from "node:assert/strict";
import test from "node:test";
import { buildFlow, exitsOf } from "../public/sf6-graph.js";
import type { PlanResult, PlanSequence, PlanSituation } from "../public/sf6-plan.js";

const situation = (overrides: Partial<PlanSituation> = {}): PlanSituation => ({
  id: 1, character: "リュウ", kind: "state", name: "局面", presetKey: null, advantage: 10, position: "anywhere", recovery: null, ...overrides,
});
const result = (overrides: Partial<PlanResult> = {}): PlanResult => ({ kind: "hit", opponentAction: null, outcome: null, nextSituationId: null, ...overrides });
const sequence = (overrides: Partial<PlanSequence> = {}): PlanSequence => ({
  id: 1, character: "リュウ", title: "手順", notation: "5弱P", startup: null, driveCost: 0, saCost: 0, position: "anywhere",
  mastery: 0, archived: false, starts: [], results: [], ...overrides,
});
const label = (exit: { kind: string; opponentAction: string | null }) => (exit.kind === "opponent" ? exit.opponentAction ?? "" : exit.kind);

test("どのパーツも、ヒットが無ければ未設定の結果として足す。ガードや相手の行動は入力したときだけ出る", () => {
  assert.deepEqual(exitsOf(sequence()).map((exit) => exit.kind), ["hit"]);
  const setplay = sequence({ results: [result({ kind: "opponent", opponentAction: "tech", outcome: "win" }), result({ kind: "opponent", opponentAction: "reversal", outcome: "lose" })] });
  assert.deepEqual(exitsOf(setplay).map((exit) => exit.opponentAction ?? exit.kind), ["hit", "reversal", "tech"]);
});

test("結果の次の状況から始まる手順へ矢印を引き、手順は右の桁に置く", () => {
  const situations = [situation({ id: 1 }), situation({ id: 2, advantage: 20 })];
  const combo = sequence({ id: 1, starts: [], results: [result({ nextSituationId: 1 })] });
  const setplay = sequence({ id: 2, starts: [1], results: [result({ nextSituationId: 2 })] });
  const flow = buildFlow({ sequences: [combo, setplay], situations, character: "リュウ", resultLabel: label });
  assert.deepEqual(flow.edges.map((edge) => [edge.from, edge.to]), [[1, 2]]);
  const [first, second] = flow.nodes;
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.ok(second.x > first.x);
});

test("次の状況が未設定の結果と、続く手順がない結果は出口になる", () => {
  const situations = [situation({ id: 1 }), situation({ id: 2, advantage: 50 })];
  const setplay = sequence({ id: 2, starts: [1], results: [result({ nextSituationId: 2 })] });
  const flow = buildFlow({ sequences: [setplay], situations, character: "リュウ", resultLabel: label });
  assert.deepEqual(flow.stubs.map((stub) => [stub.resultKind, stub.type]), [["hit", "dead"]]);
  assert.equal(flow.unsetCount, 0);
});

test("A→B→Aの循環でも止まり、全部の手順が出る。アーカイブと他キャラは出ない", () => {
  const situations = [situation({ id: 1 }), situation({ id: 2, advantage: 30 })];
  const a = sequence({ id: 1, starts: [1], results: [result({ nextSituationId: 2 })] });
  const b = sequence({ id: 2, starts: [2], results: [result({ nextSituationId: 1 })] });
  const archived = sequence({ id: 3, archived: true, starts: [1] });
  const other = sequence({ id: 4, character: "ケン", starts: [1] });
  const flow = buildFlow({ sequences: [a, b, archived, other], situations, character: "リュウ", resultLabel: label });
  assert.deepEqual(flow.nodes.map((node) => node.id).sort(), [1, 2]);
  // 戻る矢印は図を横切らせず、戻り先を示す小さな枠にする。つながり自体は links に残る
  assert.equal(flow.edges.length, 1);
  assert.deepEqual(flow.stubs.map((stub) => [stub.type, stub.sequenceId, stub.targetId]), [["loop", 2, 1]]);
  assert.equal(flow.links.length, 2);
});

test("始点の状況を渡すと、そこから届く手順だけを出す", () => {
  const situations = [situation({ id: 1 }), situation({ id: 2, advantage: 30 }), situation({ id: 3, advantage: 80 })];
  const a = sequence({ id: 1, starts: [1], results: [result({ nextSituationId: 2 })] });
  const b = sequence({ id: 2, starts: [2] });
  const apart = sequence({ id: 3, starts: [3] });
  const flow = buildFlow({ sequences: [a, b, apart], situations, character: "リュウ", startSituationId: 1, resultLabel: label });
  assert.deepEqual(flow.nodes.map((node) => node.id), [1, 2]);
});

test("有利Fが近い・同じだけの別の局面から始まる手順へは、自動で矢印を引かない", () => {
  const situations = [situation({ id: 1, advantage: 10 }), situation({ id: 2, advantage: 11 }), situation({ id: 3, advantage: 10 })];
  const combo = sequence({ id: 1, starts: [], results: [result({ nextSituationId: 1 })] });
  const near = sequence({ id: 2, starts: [2], results: [] });
  const same = sequence({ id: 3, starts: [3], results: [] });
  const flow = buildFlow({ sequences: [combo, near, same], situations, character: "リュウ", resultLabel: label });
  assert.deepEqual(flow.edges, []);
});

test("カウンターヒットは入力したときだけ出口になり、未入力の起き攻めに未設定の出口を足さない", () => {
  assert.deepEqual(exitsOf(sequence()).map((exit) => exit.kind), ["hit"]);
  const setplay = sequence({ results: [result({ kind: "counter_hit", nextSituationId: 2 }), result({ kind: "hit", nextSituationId: 1 })] });
  assert.deepEqual(exitsOf(setplay).map((exit) => exit.kind), ["hit", "counter_hit"]);
  const all = sequence({ results: [result({ kind: "hit_other", nextSituationId: 3 }), result({ kind: "punish_counter", nextSituationId: 2 })] });
  assert.deepEqual(exitsOf(all).map((exit) => exit.kind), ["hit", "punish_counter", "hit_other"]);
});

test("畳んだ手順より先の分岐と出口を隠し、ほかの道で辿れる手順は残す。未設定の出口だけを隠すこともできる", () => {
  const situations = [situation({ id: 1 }), situation({ id: 2, advantage: 20 }), situation({ id: 3, advantage: 30 })];
  const a = sequence({ id: 1, starts: [1], results: [result({ nextSituationId: 2 })] });
  const b = sequence({ id: 2, starts: [2], results: [result({ nextSituationId: 3 })] });
  const c = sequence({ id: 3, starts: [3], results: [] });
  const base = { sequences: [a, b, c], situations, character: "リュウ", resultLabel: label };
  assert.deepEqual(buildFlow(base).nodes.map((node) => node.id), [1, 2, 3]);
  const folded = buildFlow({ ...base, collapsed: [1] });
  assert.deepEqual(folded.nodes.map((node) => [node.id, node.collapsed, node.hiddenCount]), [[1, true, 2]]);
  assert.deepEqual(folded.stubs, []);
  // 別の道（始動が重なる手順）で辿れるものは残る
  const d = sequence({ id: 4, starts: [1], results: [result({ nextSituationId: 3 })] });
  const viaOther = buildFlow({ ...base, sequences: [a, b, c, d], collapsed: [1] });
  assert.deepEqual(viaOther.nodes.map((node) => node.id), [1, 4, 3]);
  // 循環の中で畳んでも、畳んだ手順は残る
  const x = sequence({ id: 1, starts: [1], results: [result({ nextSituationId: 2 })] });
  const y = sequence({ id: 2, starts: [2], results: [result({ nextSituationId: 1 })] });
  assert.deepEqual(buildFlow({ ...base, sequences: [x, y], collapsed: [1] }).nodes.map((node) => node.id), [1]);
  // 未設定の出口（赤い枠）は、隠しても件数は数える
  const open = sequence({ id: 9, starts: [1], results: [] });
  const withUnset = buildFlow({ ...base, sequences: [open], situations });
  assert.deepEqual([withUnset.stubs.length, withUnset.unsetCount], [1, 1]);
  const hidden = buildFlow({ ...base, sequences: [open], situations, hideUnset: true });
  assert.deepEqual([hidden.stubs.length, hidden.unsetCount], [0, 1]);
});
