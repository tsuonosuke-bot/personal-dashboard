import { readClientScript } from "./clientScript.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appendToken, parseNotation } from "../public/sf6-notation.js";
import {
  bestStreakOf, defaultTitle, drillPreset, findState, raiseTargets, routeBack, routeDrillPreset, sequencesFrom, partsAfter,
  shouldRaiseMastery, situationUsage, sortSequences, startSituationGroups, stateLabel, usableNow, usesDrive,
  type PlanSequence, type PlanSituation, type RouteStep,
} from "../public/sf6-plan.js";

const situation = (overrides: Partial<PlanSituation> = {}): PlanSituation => ({
  id: 1, character: null, kind: "trigger", name: "確定反撃", presetKey: null, advantage: null, position: "anywhere",
  recovery: null, archived: false, ...overrides,
});
const state = (id: number, advantage: number, overrides: Partial<PlanSituation> = {}) => situation({
  id, character: "ケン", kind: "state", name: `局面${id}`, advantage, recovery: "back_roll", ...overrides,
});
const sequence = (overrides: Partial<PlanSequence> = {}): PlanSequence => ({
  id: 1, character: "ケン", title: "中足ラッシュ", notation: "2中K > 5中P", startup: 5,
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

test("バーンアウト中は、Dゲージ0でもDR・DI・パリィ・OD必殺技を含む手順を出さない（スタンスの2PPやSAは出す）", () => {
  for (const notation of ["2中K > DR 5中P", "5中P xx 236PP", "2中P xx 623KK", "5中P xx 63214PP", "J236KK", "パリィ 5強P", "6 DI", "5強P DI", "パリィ DR 5中P", "5中P xx DR 5中P"]) {
    assert.equal(usesDrive(notation), true, notation);
  }
  for (const notation of ["5弱P > 5弱P xx 623強K", "2強P xx 2PP 6弱P", "PP", "5中P xx SA2", "2中P xx 236236P", "投げ", "4 投げ"]) {
    assert.equal(usesDrive(notation), false, notation);
  }
  // 63214PP PP は前の 63214PP（OD）で外れる。後ろの単独 PP（派生）だけでは外さない
  assert.equal(usesDrive("63214PP PP"), true);
  // 方向1つ以下で書いたOD技はレシピからは拾わない（Dゲージ消費の値で外れる）
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "2強P xx 2PP 中P" }), { burnout: true }), true);
  assert.equal(usableNow(sequence({ driveCost: 1, notation: "溜め 6PP" }), { burnout: true }), false);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "5弱P xx 623強K" }), { burnout: true }), true);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "2中K > DR 5中P" }), { burnout: true }), false);
  assert.equal(usableNow(sequence({ driveCost: 0, notation: "5中P xx 236PP" }), { burnout: true }), false);
  assert.equal(usableNow(sequence({ driveCost: 1, notation: "5中P" }), { burnout: true }), false);
});

test("確定反撃と不利F指定は発生の速い順、それ以外は登録順", () => {
  const byId = new Map([[1, punish], [2, confirm]]);
  const list = [
    sequence({ id: 1, startup: 7 }),
    sequence({ id: 2, startup: null }),
    sequence({ id: 3, startup: 4 }),
  ];
  assert.deepEqual(sortSequences(list, { situationId: 1 }, byId).map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(sortSequences(list, { situationId: 1, punishWindow: 7 }, byId).map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(sortSequences(list, { punishWindow: 7 }, byId).map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(sortSequences(list, { situationId: 2 }, byId).map((entry) => entry.id), [1, 2, 3]);
  assert.deepEqual(sortSequences(list, {}, byId).map((entry) => entry.id), [1, 2, 3]);
  // 不利F5：発生5F以下だけが残る（A3）
  const window = list.filter((entry) => usableNow(entry, { punishWindow: 5 }));
  assert.deepEqual(sortSequences(window, { punishWindow: 5 }, byId).map((entry) => entry.id), [3]);
});

test("始動の候補は選択中を分け、同じキャラの最近の始動を優先し、残りを折りたたむ", () => {
  const situations = [punish, confirm, counter, situation({ id: 4 }),
    ...Array.from({ length: 7 }, (_, index) => state(index + 10, 20)),
    state(20, 30, { character: "リュウ" }), state(21, 30, { archived: true }),
    state(22, 30, { archived: true }), situation({ id: 23, character: "リュウ" }),
  ];
  const sequences = [
    sequence({ id: 1, starts: [14, 15], updatedAt: "2026-10-20T00:00:00Z" }),
    sequence({ id: 2, starts: [16, 13], updatedAt: "2026-10-22T00:00:00Z" }),
    sequence({ id: 3, starts: [12], archived: true, updatedAt: "2026-10-23T00:00:00Z" }),
  ];
  const groups = startSituationGroups(situations, sequences, "ケン", [2, 10, 21, 20, 23]);
  assert.deepEqual(groups.selected.map((entry) => entry.id), [2, 10, 21]);
  assert.deepEqual(groups.triggers.visible.map((entry) => entry.id), [1, 3, 4]);
  assert.deepEqual(groups.states.visible.map((entry) => entry.id), [16, 13, 14]);
  assert.deepEqual(groups.states.more.map((entry) => entry.id), [15, 11, 12]);
  assert.deepEqual(startSituationGroups(situations, sequences, "", [10]).states.visible, []);
  assert.deepEqual(situations.slice(-4).map((entry) => entry.id), [20, 21, 22, 23]);
});

test("道のりの手順へ戻ると直前の状況で候補を再表示し、後続を練習の対象から外す", () => {
  const path: RouteStep[] = [{ situationId: 1 }, { sequenceId: 10, resultKind: "hit" }, { situationId: 2 },
    { sequenceId: 11, resultKind: "guard" }, { situationId: 3 }, { sequenceId: 12, resultKind: null }];
  assert.deepEqual(routeBack(path, 1), { path: [{ situationId: 1 }], sequenceId: 10 });
  assert.deepEqual(routeBack(path, 2), { path: path.slice(0, 3), sequenceId: null });
  assert.deepEqual(routeBack(path, 5), { path: path.slice(0, 5), sequenceId: 12 });
  const back = routeBack(path, 3)!;
  assert.equal(back.sequenceId, 11);
  assert.equal(back.path.length, 3);
  const drills = routeDrillPreset(back.path, new Map([[10, sequence({ id: 10 })], [11, sequence({ id: 11 })]]), new Map());
  assert.deepEqual(drills.sequenceIds, [10]);
  assert.equal(routeBack(path, -1), null);
  assert.equal(routeBack(path, 6), null);
  assert.equal(path.length, 6);
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

test("状況から始まる手順は、始動に選んだものだけを1段返す。ループする局面でも止まる", () => {
  const corner = state(6, 29, { position: "corner" });
  const anywhere = state(5, 29);
  const situations = [punish, anywhere, corner];
  const loop = sequence({ id: 10, title: "端ループ", starts: [6], results: [hit(6)] });
  const combo = sequence({ id: 11, title: "中P 強エアニー", starts: [1], results: [hit(5)] });
  const other = sequence({ id: 12, title: "中央", starts: [5] });
  const archived = sequence({ id: 13, starts: [6], archived: true });
  const fromCorner = sequencesFrom(corner, [loop, combo, other, archived], situations);
  // フレームからの自動的なつなぎはしない：始動に選んだ状況だけ（同じ有利Fの別の局面は出ない）
  assert.deepEqual(fromCorner.map((entry) => entry.sequence.id), [10]);
  assert.deepEqual(sequencesFrom(punish, [loop, combo], situations).map((entry) => entry.sequence.id), [11]);
  assert.deepEqual(partsAfter(combo, [loop, combo, other], situations).map((entry) => entry.sequence.id), [12]);
  assert.deepEqual(sequencesFrom(state(9, 31), [other]), []);
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
  const setplay = sequence({ id: 2, title: "前ステ 中パワーボム", starts: [6], results: [{ kind: "opponent", opponentAction: "tech", outcome: "win", nextSituationId: null }] });
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
  // 手順で終える道のり（D1・A5）：確定反撃 › コンボ › 局面 › 起き攻め（次の状況のない起き攻めで終える）
  const ended = routeDrillPreset(
    [{ situationId: 1 }, { sequenceId: 1, resultKind: "hit" }, { situationId: 6 }, { sequenceId: 2, resultKind: null }],
    new Map([[1, combo], [2, setplay]]),
    new Map([[1, punish], [6, corner]]),
  );
  assert.equal(ended.title, "確定反撃 › 弱連打 強エアニー › 前ステ 中パワーボム");
  assert.deepEqual(ended.sequenceIds, [1, 2]);
  assert.deepEqual([ended.guardSetting, ended.recoverySetting, ended.reversalRecorded], ["random", "random", true]);
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

test("SF6ページは5タブ（コンボと起き攻めはコンボパーツに統合・フレームあり・注意点なし）で、バーンアウトの手入力と「注意点にする」がない", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/sf6/index.html", import.meta.url), "utf8"),
    readClientScript("sf6"),
  ]);
  assert.deepEqual([...html.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1]), ["sequences", "situations", "frames", "drills", "matches"]);
  // コンボと起き攻めは1種類のコンボパーツに統合し、種類の絞り込みは持たない
  assert.doesNotMatch(html, /id="sequenceKind"/);
  assert.doesNotMatch(html, /data-tab="notes"|注意点/);
  assert.match(html, /<small>コンボパーツ・練習<\/small>/);
  assert.match(html, /id="conditionBurnout"/);
  assert.match(html, /id="conditionPunish"/);
  assert.match(html, /id="sheet"/);
  assert.match(html, /id="situationList"/);
  assert.match(html, /data-manage-situations/);
  assert.match(html, /data-open-flow/);
  assert.doesNotMatch(script, /burnoutOk|data-note-from-match|noteFromMatch/);
  // ルートは手順で終えられる（D1）。フレームの詳細行は見えている列の数だけ広げる（M2）
  assert.match(script, /data-route-end="\$\{sequence\.id\}">この手順で終える</);
  assert.match(script, /colspan="\$\{WIDE_FRAMES\.matches \? 6 : 4\}"/);
  // 初期の状況は削除ボタンを出さない（D3）
  assert.match(script, /resource === "situations" && Boolean\(item\.presetKey\)/);
  assert.match(script, /const TABS = \["sequences", "situations", "frames", "drills", "matches"\]/);
});

test("ヘルプは状況・局面・ルート・フレームを説明し、注意点の説明はない", async () => {
  const help = await readFile(new URL("../public/help/index.html", import.meta.url), "utf8");
  const section = help.slice(help.indexOf('<section id="sf6"'), help.indexOf("</section>", help.indexOf('<section id="sf6"')));
  for (const word of ["ルート", "局面", "きっかけ", "パニッシュカウンター", "相手が画面端", "外して削除", "相手の不利F", "発生F", "+2F", "+4F"]) {
    assert.ok(section.includes(word), word);
  }
  assert.doesNotMatch(help, /注意点/);
  assert.doesNotMatch(section, /バーンアウト中も使える/);
});

test("Phase1 migration は7つの新しい表と関数の権限を絞り、既存データをコピーする。Phase2 はガードのあとで旧表を消す", async () => {
  const [phase1, phase2] = await Promise.all([
    readFile(new URL("../supabase/migrations/202610120002_sf6_sequences.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202610120003_sf6_drop_legacy.sql", import.meta.url), "utf8"),
  ]);
  const tables = ["sf6_situations", "sf6_sequences", "sf6_sequence_starts", "sf6_sequence_results", "sf6_move_sets", "sf6_moves"];
  for (const table of tables) {
    assert.match(phase1, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(phase1, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
  const revoke = phase1.slice(phase1.indexOf("revoke all on table"), phase1.indexOf("from public, anon, authenticated;", phase1.indexOf("revoke all on table")));
  const grant = phase1.slice(phase1.indexOf("grant select, insert, update, delete on table"), phase1.indexOf("to service_role;", phase1.indexOf("grant select, insert, update, delete on table")));
  for (const table of tables) {
    assert.ok(revoke.includes(`public.${table}`), `revoke ${table}`);
    assert.ok(grant.includes(`public.${table}`), `grant ${table}`);
  }
  assert.match(phase1, /add column if not exists sequence_ids bigint\[\] not null default '\{\}'/);
  for (const signature of ["sf6_situations_guard_update()", "sf6_situations_guard_delete()", "sf6_resolve_situation(text, jsonb)", "sf6_save_sequence(bigint, timestamptz, jsonb, jsonb, jsonb)", "sf6_delete_sequence(bigint)", "sf6_copy_legacy()"]) {
    const escaped = signature.replace(/[()[\]]/g, "\\$&");
    assert.match(phase1, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`));
    assert.match(phase1, new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
  }
  assert.match(phase1, /create unique index if not exists sf6_situations_state_key/);
  // 使用中の状況のキャラ・種類（D2）、初期の状況の削除（D3）はDBでも拒む
  assert.match(phase1, /create trigger sf6_situations_guard_update\s+before update on public\.sf6_situations/);
  assert.match(phase1, /create trigger sf6_situations_guard_delete\s+before delete on public\.sf6_situations/);
  assert.match(phase1, /raise exception 'SF6_SITUATION_IN_USE'/);
  assert.match(phase1, /raise exception 'SF6_PRESET_SITUATION'/);
  // 楽観ロックは updated_at が null でも競合にする（R1）
  assert.match(phase1, /p_updated_at is null or v_old\.updated_at is distinct from p_updated_at/);
  assert.match(phase1, /on conflict \(character, advantage, position, \(coalesce\(recovery, ''\)\)\) where kind = 'state'/);
  assert.match(phase1, /select public\.sf6_copy_legacy\(\);\s*$/);
  // 新しい保存関数は旧表の列（Phase2 で消える）を参照しない
  const save = phase1.slice(phase1.indexOf("create or replace function public.sf6_save_sequence"), phase1.indexOf("create or replace function public.sf6_delete_sequence"));
  assert.doesNotMatch(save, /legacy_|burnout_ok|sf6_combos|sf6_setplays/);
  for (const guard of ["SF6_NOTES_NOT_EMPTY", "SF6_COMBOS_NOT_COPIED", "SF6_SETPLAYS_NOT_COPIED", "SF6_DRILLS_NOT_COPIED"]) {
    assert.match(phase2, new RegExp(`raise exception '${guard}'`));
  }
  // 旧画面でコピー後に消した行は止め（R4）、新画面で消したコピーは通す。練習は対応する手順があるのに空のときだけ止める（R3）
  assert.match(phase2, /not exists \(select 1 from public\.sf6_combos c where c\.id = s\.legacy_combo_id\)/);
  assert.match(phase2, /\(s\.id is null and c\.updated_at > v_last_copy\)/);
  assert.match(phase2, /d\.sequence_ids = '\{\}'\s+and exists \(select 1 from public\.sf6_sequences s/);
  assert.ok(phase2.indexOf("drop table if exists public.sf6_setplays") < phase2.indexOf("drop table if exists public.sf6_combos"));
  assert.match(phase2, /drop table if exists public\.sf6_notes;/);
  assert.match(phase2, /drop function if exists public\.sf6_copy_legacy\(\);/);
  assert.ok(phase2.indexOf("end $$;") < phase2.indexOf("drop "), "the guard runs before anything is dropped");
});
