import assert from 'node:assert/strict';
import test from 'node:test';
import { createSf6IndexCache, createSf6Indexes } from '../public/sf6/indexes.js';
import { renderSf6VisibleTab } from '../public/sf6/render.js';
import { partsAfter, sequencesFrom, situationUsage, type PlanSequence, type PlanSituation } from '../public/sf6-plan.js';
import { buildFlow } from '../public/sf6-graph.js';
import { readFile } from 'node:fs/promises';

const situation = (id: number): PlanSituation => ({ id, kind: 'state', character: 'リュウ', name: `局面${id}`,
  advantage: id, position: 'anywhere', recovery: null });
const sequence = (id: number, size: number): PlanSequence => ({ id, title: `手順${id % 7}`, character: id % 5 ? 'リュウ' : 'ケン',
  notation: '5LP', startup: 5, driveCost: 0, saCost: 0, position: 'anywhere', mastery: 0, archived: id % 11 === 0,
  starts: [id, id % size + 1], results: [{ kind: 'hit', nextSituationId: id % size + 1, opponentAction: null, outcome: null }] });

test('状況/手順/練習/記録の索引は従来の抽出と同じ結果と順番を返す', () => {
  const situations = Array.from({ length: 400 }, (_, i) => situation(i + 1));
  const sequences = Array.from({ length: 400 }, (_, i) => sequence(i + 1, 400));
  const drills = [{ id: 1, status: 'active', sequenceIds: [1, 2] }, { id: 2, status: 'active', sequenceIds: [1] }];
  const logs = [{ drillId: 1, id: 2 }, { drillId: 2, id: 3 }, { drillId: 1, id: 1 }];
  const indexes = createSf6Indexes({ situations, sequences, drills, logs });
  for (const current of situations) {
    assert.deepEqual(indexes.from(current), sequencesFrom(current, sequences));
    assert.deepEqual(indexes.from(current, 'リュウ'), sequencesFrom(current, sequences.filter((row) => row.character === 'リュウ')));
    assert.deepEqual(indexes.usage(current.id), situationUsage(current.id, sequences));
  }
  for (const part of sequences) assert.deepEqual(indexes.partsAfter(part), partsAfter(part, sequences, situations));
  assert.equal(indexes.activeDrills.get(1)?.id, 1);
  assert.deepEqual(indexes.logs.get(1), logs.filter((log) => log.drillId === 1));
})

test('同じデータ内の保存/削除もinvalidate後に反映し、描画だけでは索引を作り直さない', () => {
  const data = { situations: [situation(1), situation(2)], sequences: [sequence(1, 2)], drills: [], logs: [] };
  const cache = createSf6IndexCache(() => data);
  const first = cache.get();
  for (let i = 0; i < 500; i++) assert.equal(cache.get(), first);
  data.sequences[0] = { ...data.sequences[0], title: '保存後', starts: [2] };
  cache.invalidate();
  assert.notEqual(cache.get(), first);
  assert.equal(cache.get().sequences.get(1)?.title, '保存後');
  assert.equal(cache.get().from(data.situations[0]).length, 0);
  data.sequences.splice(0, 1);
  cache.invalidate();
  assert.equal(cache.get().sequences.size, 0);
})

test('練習ログ保存も共通の保存経路を通り、索引のログと直近順を更新する', async () => {
  const [editor, controller] = await Promise.all([
    readFile(new URL('../public/sf6/editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/sf6.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(editor, /state\.data\.logs\.(?:unshift|push)/);
  assert.match(editor, /applySaved\(resource, saved\);/);
  assert.match(controller, /indexCache\.invalidate\(\)/);
  const data = { situations: [situation(1)], sequences: [sequence(1, 1)], drills: [{ id: 2, status: 'active', sequenceIds: [1] }],
    logs: [{ drillId: 2, id: 1, bestStreak: 3, practicedOn: '2026-10-25' }] };
  const cache = createSf6IndexCache(() => data);
  assert.equal(cache.get().logs.get(2)?.[0].bestStreak, 3);
  data.logs.push({ drillId: 2, id: 2, bestStreak: 10, practicedOn: '2026-10-26' });
  data.logs.sort((a, b) => b.practicedOn.localeCompare(a.practicedOn) || b.id - a.id);
  cache.invalidate();
  assert.equal(cache.get().logs.get(2)?.[0].bestStreak, 10);
  assert.equal(cache.get().logs.get(2)?.length, 2);
})

test('非表示タブの描画を呼ばず、切替後は最新データを描く', () => {
  let revision = 1;
  const calls: Array<[string, number]> = [];
  const renderers = Object.fromEntries(['sequences', 'situations', 'frames', 'drills', 'matches'].map((tab) => [tab, () => { calls.push([tab, revision]); }]));
  renderSf6VisibleTab('sequences', renderers);
  revision = 2;
  renderSf6VisibleTab('drills', renderers);
  renderSf6VisibleTab('unknown', renderers);
  assert.deepEqual(calls, [['sequences', 1], ['drills', 2]]);
})

test('フローの始動関係の走査は100/200/400件で二乗に増えず、全ノードを維持する', () => {
  const scans: number[] = [];
  for (const size of [100, 200, 400]) {
    const situations = Array.from({ length: size }, (_, i) => situation(i + 1));
    let readStarts = 0;
    const sequences = Array.from({ length: size }, (_, i) => {
      const row = { ...sequence(i + 1, size), character: 'リュウ', archived: false };
      const starts = [row.id];
      Object.defineProperty(row, 'starts', { get() { readStarts++; return starts; } });
      return row;
    });
    const flow = buildFlow({ sequences, situations, character: 'リュウ', resultLabel: (exit) => exit.kind });
    assert.equal(flow.nodes.length, size);
    assert.equal(flow.links.length, size);
    assert.ok(readStarts <= size * 2, `${size}: ${readStarts}`);
    scans.push(readStarts);
  }
  assert.deepEqual(scans, [200, 400, 800]);
})
