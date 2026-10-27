import assert from 'node:assert/strict';
import test from 'node:test';
import { knowledgeActivity } from '../public/knowledge-activity.js';

const now = new Date('2026-10-27T14:59:59Z');
const base = { reviewReadyDue: 0, knowledgeAnsweredOn: '2026-10-27', knowledgeAnsweredToday: 12 };
test('review availability takes priority over recorded answers, with normal entry for zero/unknown', () => {
  assert.equal(knowledgeActivity({ ...base, reviewReadyDue: 4 }, now).label, '復習 4問');
  assert.equal(knowledgeActivity({ ...base, reviewReadyDue: 4 }, now).startReview, true);
  assert.equal(knowledgeActivity(base, now).label, '今日 12問回答');
  assert.equal(knowledgeActivity({ ...base, knowledgeAnsweredToday: 0 }, now).label, '復習なし');
  assert.equal(knowledgeActivity({ ...base, reviewReadyDue: null }, now).label, '復習数不明');
  assert.equal(knowledgeActivity({ ...base, reviewReadyDue: null }, now).startReview, false);
});
test('mixed rollout, invalid values and JST midnight never turn unknown or old answers into today', () => {
  for (const invalid of [null, undefined, -1, 1.5, '12', NaN, Infinity]) {
    const view = knowledgeActivity({ ...base, knowledgeAnsweredToday: invalid }, now);
    assert.equal(view.label, '復習なし');
    assert.match(view.detail, /取得できません/);
  }
  assert.equal(knowledgeActivity(base, new Date('2026-10-27T15:00:00Z')).label, '復習なし');
  assert.match(knowledgeActivity(base, new Date('2026-10-27T15:00:00Z')).detail, /取得できません/);
  assert.equal(knowledgeActivity({ reviewReadyDue: 3 }, now).label, '復習 3問');
  assert.equal(knowledgeActivity({ reviewReadyDue: null }, now).label, '復習数不明');
});
