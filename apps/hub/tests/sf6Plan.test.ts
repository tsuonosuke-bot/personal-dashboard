import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSf6Fields } from "../functions/_shared/sf6.ts";
import { appendToken, parseNotation } from "../public/sf6-notation.js";
import {
  bestStreakOf, setplayFit, setplaysAfter, shouldRaiseMastery, situationOptions, SITUATION_PRESETS, usableNow,
  type PlanCombo, type PlanSetplay,
} from "../public/sf6-plan.js";

const combo = (overrides: Partial<PlanCombo> = {}): PlanCombo => ({
  id: 1, character: "ケン", position: "anywhere", situations: ["ヒット確認"], driveCost: 3, saCost: 0, burnoutOk: false,
  endAdvantage: 31, recovery: "back_roll", mastery: 1, damage: 2800, ...overrides,
});
const setplay = (overrides: Partial<PlanSetplay> = {}): PlanSetplay => ({
  id: 10, character: "ケン", title: "前ステ中P重ね", comboIds: [], startAdvantage: 31, position: "anywhere",
  recovery: "back_roll", archived: false, ...overrides,
});

test("状況はプリセットのあとに自作の状況を並べる", () => {
  const list = situationOptions([{ situations: ["昇龍ガード後", "対空"] }, { situations: ["インパクト返し後"] }]);
  assert.deepEqual(list.slice(0, SITUATION_PRESETS.length), SITUATION_PRESETS);
  assert.deepEqual(list.slice(SITUATION_PRESETS.length).sort(), ["インパクト返し後", "昇龍ガード後"].sort());
});

test("状況・位置・ゲージ・バーンアウトで今使えるコンボを絞る", () => {
  assert.equal(usableNow(combo(), { situation: "ヒット確認" }), true);
  assert.equal(usableNow(combo(), { situation: "対空" }), false);
  assert.equal(usableNow(combo({ position: "corner" }), { position: "midscreen" }), false);
  assert.equal(usableNow(combo(), { position: "corner" }), true);
  assert.equal(usableNow(combo({ driveCost: 3 }), { drive: 2.5 }), false);
  assert.equal(usableNow(combo({ driveCost: 1.5 }), { drive: 2 }), true);
  assert.equal(usableNow(combo(), { burnout: true }), false);
  assert.equal(usableNow(combo({ driveCost: 0, burnoutOk: true }), { burnout: true }), true);
  assert.equal(usableNow(combo({ saCost: 2 }), { sa: 1 }), false);
  // CAは3本＋CA可（体力25%以下）のときだけ
  assert.equal(usableNow(combo({ saCost: 4 }), { sa: 3 }), false);
  assert.equal(usableNow(combo({ saCost: 4 }), { sa: 3, ca: true }), true);
  assert.equal(usableNow(combo({ saCost: 4 }), {}), true);
});

test("締めから行ける起き攻めは、紐づけ→有利F・位置・受け身の一致→±2Fの順", () => {
  assert.equal(setplayFit(combo(), setplay()), "exact");
  assert.equal(setplayFit(combo({ endAdvantage: 33 }), setplay()), "near");
  assert.equal(setplayFit(combo({ endAdvantage: 34 }), setplay()), null);
  assert.equal(setplayFit(combo({ recovery: "no_back_roll" }), setplay()), null);
  assert.equal(setplayFit(combo({ position: "corner" }), setplay({ position: "midscreen" })), null);
  assert.equal(setplayFit(combo({ character: "リュウ" }), setplay()), null);
  assert.equal(setplayFit(combo({ endAdvantage: 10 }), setplay({ comboIds: [1] })), "linked");
  assert.equal(setplayFit(combo(), setplay({ archived: true })), null);
  const order = setplaysAfter(combo(), [
    setplay({ id: 11, title: "B", startAdvantage: 30 }),
    setplay({ id: 12, title: "A" }),
    setplay({ id: 13, title: "C", startAdvantage: 5, comboIds: [1] }),
  ]).map((entry) => [entry.setplay.id, entry.fit]);
  assert.deepEqual(order, [[13, "linked"], [12, "exact"], [11, "near"]]);
});

test("10回連続を達成していれば、習得度を3段階目に上げる提案を出す", () => {
  assert.equal(bestStreakOf([{ bestStreak: 4 }, { bestStreak: null }, { bestStreak: 10 }]), 10);
  assert.equal(shouldRaiseMastery({ mastery: 1 }, [{ bestStreak: 10 }]), true);
  assert.equal(shouldRaiseMastery({ mastery: 2 }, [{ bestStreak: 12 }]), false);
  assert.equal(shouldRaiseMastery({ mastery: 0 }, [{ bestStreak: 9 }]), false);
  assert.equal(shouldRaiseMastery(null, [{ bestStreak: 10 }]), false);
});

test("起き攻めの手順に移動・タイミングの基準を使える", () => {
  let text = "";
  for (const key of ["前ステ", "2", "中P", "重ね"]) text = appendToken(text, key);
  assert.equal(text, "前ステ 2中P 重ね");
  assert.deepEqual(parseNotation(text).map((part) => part.type), ["link", "command", "link"]);
  assert.equal((parseNotation("前ステ")[0] as { kind: string }).kind, "move");
});

const fullCombo = {
  character: "ケン", title: "t", notation: "2中K > DR", position: "anywhere", damage: null, driveCost: 1.5, saCost: 4,
  mastery: 0, memo: null, archived: false, situations: ["ヒット確認", " 昇龍ガード後 "], burnoutOk: false,
  endAdvantage: 31, recovery: "back_roll", endPurpose: "oki",
};

test("コンボの新しい項目（状況・半本ゲージ・CA・締め後）を検証する", () => {
  const result = validateSf6Fields("combos", fullCombo);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.situations, ["ヒット確認", "昇龍ガード後"]);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, driveCost: 1.25 }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, saCost: 5 }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, situations: ["a", "a"] }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, situations: [""] }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, recovery: "tech" }).ok, false);
  assert.equal(validateSf6Fields("combos", { ...fullCombo, endAdvantage: null, recovery: null, endPurpose: null }).ok, true);
});

test("項目を増やす前の画面から送られた保存も通り、送られなかった項目は変えない", () => {
  const { situations: _s, burnoutOk: _b, endAdvantage: _e, recovery: _r, endPurpose: _p, ...old } = fullCombo;
  const result = validateSf6Fields("combos", { ...old, driveCost: 3, saCost: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal("situations" in result.value, false);
});

test("起き攻めは結果の○×を検証し、未確認は保存しない", () => {
  const value = {
    character: "ケン", title: "前ステ中P", comboIds: [1, 2], startAdvantage: 31, position: "corner", recovery: "no_back_roll",
    notation: "前ステ 2中P 重ね", layering: "meaty", aim: "shimmy", backRollOk: "unknown",
    outcomes: { reversal: "lose", tech: "win", jump: "unknown" }, followComboId: null, mastery: 0, memo: null, archived: false,
  };
  const result = validateSf6Fields("setplays", value);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.outcomes, { reversal: "lose", tech: "win" });
  assert.equal(validateSf6Fields("setplays", { ...value, outcomes: { dance: "win" } }).ok, false);
  assert.equal(validateSf6Fields("setplays", { ...value, outcomes: { tech: "maybe" } }).ok, false);
  assert.equal(validateSf6Fields("setplays", { ...value, comboIds: [1, 1] }).ok, false);
  assert.equal(validateSf6Fields("setplays", { ...value, aim: null }).ok, false);
});

test("練習メニューはコンボか起き攻めの片方だけ、記録の連続成功は成功数以下", () => {
  const drill = { title: "t", detail: null, comboId: 1, setplayId: null, status: "active", guardSetting: "random", counterSetting: null, recoverySetting: null, reversalRecorded: false };
  assert.equal(validateSf6Fields("drills", drill).ok, true);
  assert.equal(validateSf6Fields("drills", { ...drill, setplayId: 2 }).ok, false);
  assert.equal(validateSf6Fields("drills", { ...drill, guardSetting: "sometimes" }).ok, false);
  const log = { drillId: 1, practicedOn: "2026-10-12", attempts: 20, successes: 15, note: null, bestStreak: 10 };
  assert.equal(validateSf6Fields("logs", log).ok, true);
  assert.equal(validateSf6Fields("logs", { ...log, bestStreak: 16 }).ok, false);
  assert.equal(validateSf6Fields("logs", { ...log, attempts: null, successes: null }).ok, false);
});

test("SF6ページに起き攻めタブ・状況と条件の絞り込みがあり、ヘルプで説明している", async () => {
  const [html, help, migration] = await Promise.all([
    readFile(new URL("../public/sf6/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/help/index.html", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202610120001_sf6_situations_setplays.sql", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-tab="setplays"/);
  assert.match(html, /id="comboSituation"/);
  assert.match(html, /id="conditionBurnout"/);
  assert.match(help, /起き攻め/);
  assert.match(help, /フレームメーター/);
  assert.match(migration, /create table if not exists public\.sf6_setplays/);
  assert.match(migration, /revoke all on table public\.sf6_setplays from public, anon, authenticated;/);
});
