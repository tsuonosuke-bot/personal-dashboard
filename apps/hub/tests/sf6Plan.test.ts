import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appendToken, parseNotation } from "../public/sf6-notation.js";
import {
  bestStreakOf, defaultTitle, drillPreset, findState, leadsInto, raiseTargets, routeDrillPreset, sequencesFrom, setplaysAfter,
  shouldRaiseMastery, situationUsage, sortSequences, stateFit, stateLabel, usableNow, usesDrive,
  type PlanSequence, type PlanSituation,
} from "../public/sf6-plan.js";

const situation = (overrides: Partial<PlanSituation> = {}): PlanSituation => ({
  id: 1, character: null, kind: "trigger", name: "確定反撃", presetKey: null, advantage: null, position: "anywhere",
  recovery: null, archived: false, ...overrides,
});
const state = (id: number, advantage: number, overrides: Partial<PlanSituation> = {}) => situation({
  id, character: "ケン", kind: "state", name: `局面${id}`, advantage, recovery: "back_roll", ...overrides,
});
const sequence = (overrides: Partial<PlanSequence> = {}): PlanSequence => ({
  id: 1, kind: "combo", character: "ケン", title: "中足ラッシュ", notation: "2中K > 5中P", startup: 5, damage: 2800,
  driveCost: 0, saCost: 0, position: "anywhere", mastery: 1, archived: false, starts: [1], results: [], ...overrides,
});
const hit = (nextSituationId: number | null) => ({ kind: "hit" as const, opponentAction: null, outcome: null, nextSituationId });

const punish = situation({ id: 1, presetKey: "punish" });
const confirm = situation({ id: 2, name: "ヒット確認", presetKey: "hit_confirm" });
const counter = situation({ id: 3, name: "パニッシュカウンター", presetKey: "punish_counter" });

test("状況・位置・ゲージ・相手の不利Fで今使える手順を絞る", () => {
  assert.equal(usableNow(sequence(), { situationId: 1 }), true);
  assert.equal(usableNow(sequence(), { situationId: 2 }), false);
  assert.equal(usableNow(sequence({ starts: [] }), { situationId: "none" }), true);
  assert.equal(usableNow(sequence(), { situationId: "none" }), false);
  assert.equal(usableNow(sequence({ position: "corner" }), { position: "midscreen" }), false);
  assert.equal(usableNow(sequence(), { position: "corner" }), true);
  assert.equal(usableNow(sequence({ driveCost: 3 }), { drive: 2.5 }), false);
  assert.equal(usableNow(sequence({ driveCost: 1.5 }), { drive: 2 }), true);
  assert.equal(usableNow(sequence({ saCost: 2 }), { sa: 1 }), false);
  // CAは3本＋CA可（体力25%以下）のときだけ
  assert.equal(usableNow(sequence({ saCost: 4 }), { sa: 3 }), false);
  assert.equal(usableNow(sequence({ saCost: 4 }), { sa: 3, ca: true }), true);
  assert.equal(usableNow(sequence({ saCost: 4 }), {}), true);
  // 相手の不利F：発生がそれ以下のものだけ。発生が未入力なら出さない
  assert.equal(usableNow(sequence({ startup: 5 }), { punishWindow: 5 }), true);
  assert.equal(usableNow(sequence({ startup: 6 }), { punishWindow: 5 }), false);
  assert.equal(usableNow(sequence({ startup: null }), { punishWindow: 5 }), false);
});

test("バーンアウト中は、Dゲージ0でもDR・DI・パリィ・OD技を含む手順を出さない", () => {
  assert.equal(usesDrive("2中K > DR 5中P"), true);
  assert.equal(usesDrive("5中P xx 236PP"), true);
  assert.equal(usesDrive("パリィ 5強P"), true);
  assert.equal(usesDrive("5弱P > 5弱P xx 623強K"), false);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "5弱P xx 623強K" }), { burnout: true }), true);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "2中K > DR 5中P" }), { burnout: true }), false);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "5中P xx 236PP" }), { burnout: true }), false);
  assert.equal(usableNow(sequence({ driveCost: 1, notation: "5中P" }), { burnout: true }), false);
});

test("確定反撃は発生の速い順、不利Fを入れたらダメージ順、条件なしは登録順", () => {
  const byId = new Map([[1, punish], [2, confirm]]);
  const list = [
    sequence({ id: 1, startup: 7, damage: 3000 }),
    sequence({ id: 2, startup: null, damage: 3500 }),
    sequence({ id: 3, startup: 4, damage: 1200 }),
  ];
  assert.deepEqual(sortSequences(list, { situationId: 1 }, byId).map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(sortSequences(list, { situationId: 1, punishWindow: 7 }, byId).map((entry) => entry.id), [2, 1, 3]);
  assert.deepEqual(sortSequences(list, { situationId: 2 }, byId).map((entry) => entry.id), [2, 1, 3]);
  assert.deepEqual(sortSequences(list, {}, byId).map((entry) => entry.id), [1, 2, 3]);
  // 不利F5：発生5F以下だけがダメージ順で残る（A3）
  const window = list.filter((entry) => usableNow(entry, { punishWindow: 5 }));
  assert.deepEqual(sortSequences(window, { punishWindow: 5 }, byId).map((entry) => entry.id), [3]);
});

test("局面の表示と、同じキャラ・有利F・位置・ダウンの局面の再利用", () => {
  assert.equal(stateLabel(state(5, 29, { position: "corner" })), "+29F 画面端 後ろ受け身可");
  assert.equal(stateLabel(state(5, -3, { recovery: null })), "-3F");
  assert.equal(stateLabel(punish), "");
  const list = [state(5, 29), state(6, 29, { position: "corner" }), state(7, 29, { archived: true, recovery: "none" })];
  assert.equal(findState(list, { character: "ケン", advantage: 29, position: "corner", recovery: "back_roll" })?.id, 6);
  assert.equal(findState(list, { character: "ケン", advantage: 29, position: "anywhere", recovery: null }), null);
  assert.equal(findState(list, { character: "リュウ", advantage: 29, position: "anywhere", recovery: "back_roll" }), null);
  // アーカイブ済みは返さない（{state} で送ると、DBが同じ行を戻して使う）
  assert.equal(findState(list, { character: "ケン", advantage: 29, position: "anywhere", recovery: "none" }), null);
});

test("局面のつながり：同じ・合う（位置の片方がどこでも）・近い（±2F）", () => {
  const anywhere = state(5, 29);
  const corner = state(6, 29, { position: "corner" });
  assert.equal(stateFit(anywhere, anywhere), "same");
  assert.equal(stateFit(anywhere, corner), "fits");
  assert.equal(stateFit(anywhere, state(7, 31)), "near");
  assert.equal(stateFit(anywhere, state(7, 32)), null);
  assert.equal(stateFit(anywhere, state(7, 29, { recovery: "no_back_roll" })), null);
  assert.equal(stateFit(anywhere, state(7, 29, { recovery: null })), "near");
  assert.equal(stateFit(anywhere, state(7, 29, { character: "リュウ" })), null);
  assert.equal(stateFit(state(8, 29, { position: "midscreen" }), corner), null);
  assert.equal(stateFit(punish, punish), "same");
  assert.equal(stateFit(punish, confirm), null);
});

test("状況から始まる手順は1段だけ返し、ループする局面でも止まる", () => {
  const corner = state(6, 29, { position: "corner" });
  const anywhere = state(5, 29);
  const situations = [punish, anywhere, corner];
  const loop = sequence({ id: 10, kind: "setplay", title: "端ループ", starts: [6], results: [hit(6)] });
  const combo = sequence({ id: 11, title: "中P 強エアニー", starts: [1], results: [hit(5)] });
  const other = sequence({ id: 12, kind: "setplay", title: "中央", starts: [5] });
  const archived = sequence({ id: 13, kind: "setplay", starts: [6], archived: true });
  const fromCorner = sequencesFrom(corner, [loop, combo, other, archived], situations);
  assert.deepEqual(fromCorner.map((entry) => [entry.sequence.id, entry.fit]), [[10, "same"], [12, "fits"]]);
  assert.deepEqual(sequencesFrom(punish, [loop, combo], situations).map((entry) => entry.sequence.id), [11]);
  // どこでも+29の締めから、画面端+29の起き攻めが「合う」として出る（A2）
  assert.deepEqual(setplaysAfter(combo, [loop, combo, other], situations).map((entry) => [entry.sequence.id, entry.fit]), [[12, "same"], [10, "fits"]]);
  assert.deepEqual(leadsInto(corner, [loop, combo, other], situations).map((entry) => entry.id), [11]);
  assert.deepEqual(sequencesFrom(state(9, 31), [other], [...situations, state(9, 31)], { includeNear: false }), []);
});

test("状況の使用件数と、削除すると始動がなくなる手順の数", () => {
  const list = [
    sequence({ id: 1, starts: [1] }),
    sequence({ id: 2, starts: [1, 2], results: [hit(1)] }),
    sequence({ id: 3, starts: [2], results: [hit(5)] }),
  ];
  assert.deepEqual(situationUsage(1, list), { starts: 2, results: 1, sequenceIds: [1, 2], orphaned: 1 });
  assert.deepEqual(situationUsage(5, list), { starts: 0, results: 1, sequenceIds: [3], orphaned: 0 });
});

test("ルートを練習にすると、タイトル・手順の並び・トレモ設定が入る", () => {
  const corner = state(6, 29, { position: "corner", name: "強エアニー締め後" });
  const combo = sequence({ id: 1, title: "弱連打 強エアニー", starts: [3], results: [hit(6)] });
  const setplay = sequence({ id: 2, kind: "setplay", title: "前ステ 中パワーボム", starts: [6] });
  const situationsById = new Map([[3, counter], [6, corner]]);
  const preset = routeDrillPreset(
    [{ situationId: 3 }, { sequenceId: 1, resultKind: "hit" }, { situationId: 6 }, { sequenceId: 2, resultKind: "opponent", opponentAction: "tech" }, { situationId: 6 }, { sequenceId: 2, resultKind: "hit" }],
    new Map([[1, combo], [2, setplay]]),
    situationsById,
  );
  assert.equal(preset.title, "パニッシュカウンター › 弱連打 強エアニー › 前ステ 中パワーボム › 前ステ 中パワーボム");
  assert.deepEqual(preset.sequenceIds, [1, 2]);
  assert.equal(preset.guardSetting, "random");
  assert.equal(preset.counterSetting, "punish_counter");
  assert.equal(preset.recoverySetting, "random");
  assert.equal(preset.reversalRecorded, true);
  const single = drillPreset(sequence({ starts: [2, 3] }), new Map([[2, confirm], [3, counter]]));
  assert.deepEqual([single.sequenceIds, single.counterSetting, single.detail], [[1], "punish_counter", "ランダムガードでヒット確認して10回連続"]);
  const oki = drillPreset(setplay, situationsById);
  assert.deepEqual([oki.recoverySetting, oki.reversalRecorded], ["random", true]);
});

test("10回連続で、練習の手順のうち習得度が2未満のものを全部上げる", () => {
  assert.equal(bestStreakOf([{ bestStreak: 4 }, { bestStreak: null }, { bestStreak: 10 }]), 10);
  assert.equal(shouldRaiseMastery({ mastery: 1 }, [{ bestStreak: 10 }]), true);
  assert.equal(shouldRaiseMastery({ mastery: 2 }, [{ bestStreak: 12 }]), false);
  assert.equal(shouldRaiseMastery(null, [{ bestStreak: 10 }]), false);
  const list = [sequence({ id: 1, mastery: 0 }), sequence({ id: 2, mastery: 1 }), sequence({ id: 3, mastery: 2 })];
  assert.deepEqual(raiseTargets([2, 3, 1], list, [{ bestStreak: 10 }]).map((entry) => entry.id), [2, 1]);
  assert.deepEqual(raiseTargets([2, 1], list, [{ bestStreak: 9 }]), []);
  assert.deepEqual(raiseTargets([99], list, [{ bestStreak: 10 }]), []);
});

test("名前が空欄なら、レシピの空白をまとめて先頭40字を使う", () => {
  assert.equal(defaultTitle("  5弱P  >  5弱P xx 623強K "), "5弱P > 5弱P xx 623強K");
  assert.equal([...defaultTitle("5弱P > ".repeat(20))].length, 40);
});

test("起き攻めの手順に移動・タイミングの基準を使える", () => {
  let text = "";
  for (const key of ["前ステ", "2", "中P", "重ね"]) text = appendToken(text, key);
  assert.equal(text, "前ステ 2中P 重ね");
  assert.deepEqual(parseNotation(text).map((part) => part.type), ["link", "command", "link"]);
  assert.equal((parseNotation("前ステ")[0] as { kind: string }).kind, "move");
});

test("SF6ページは5タブ（フレームあり・注意点なし）で、バーンアウトの手入力と「注意点にする」がない", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/sf6/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/sf6.js", import.meta.url), "utf8"),
  ]);
  assert.deepEqual([...html.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1]), ["combos", "setplays", "frames", "drills", "matches"]);
  assert.doesNotMatch(html, /data-tab="notes"|注意点/);
  assert.match(html, /<small>コンボ・起き攻め・練習<\/small>/);
  assert.match(html, /id="conditionBurnout"/);
  assert.match(html, /id="conditionPunish"/);
  assert.match(html, /id="sheet"/);
  assert.match(html, /data-manage-situations/);
  assert.doesNotMatch(script, /burnoutOk|data-note-from-match|noteFromMatch/);
  assert.match(script, /const TABS = \["combos", "setplays", "frames", "drills", "matches"\]/);
});
