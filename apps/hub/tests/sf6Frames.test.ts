import assert from "node:assert/strict";
import test from "node:test";
import {
  counterText, defaultStateName, formatAdvantage, normalizeQuery, parseFrameText, punishCounterText, punishLevel, searchMoves,
  starterMove, toMoveRow, type Move,
} from "../public/sf6-frames.js";

// 架空のキャラの技（公式の値は写さない）
const move = (overrides: Partial<Move>): Move => ({
  sortOrder: 1, category: "normal", name: "立ち弱P", command: "弱P", startupText: "4", hitText: "+4", blockText: "-1",
  cancelText: "C", startup: 4, onHit: 4, hitKnockdown: false, onBlock: -1, counterOverride: null, punishCounterOverride: null,
  notes: null, ...overrides,
});
const moves: Move[] = [
  move({ sortOrder: 1 }),
  move({ sortOrder: 2, name: "溜め強P", command: "溜め 5強P", startupText: "20", hitText: "+3", blockText: "+1", cancelText: null, startup: 20, onHit: 3, onBlock: 1, punishCounterOverride: "+11", notes: "パニッシュカウンター時+11F" }),
  move({ sortOrder: 3, category: "special", name: "強 ニーアッパー", command: "623強K", startupText: "9", hitText: "D", blockText: "-30", cancelText: null, startup: 9, onHit: null, hitKnockdown: true, onBlock: -30 }),
  move({ sortOrder: 4, category: "unique", name: "ダイブチョップ", command: "J2強P", startupText: "15", hitText: "1～10", blockText: "-9～-2", cancelText: "", startup: 15, onHit: 1, onBlock: -9 }),
  move({ sortOrder: 5, category: "special", name: "中 ストレート", command: "236中P", startupText: "12", hitText: "+2", blockText: "-5", cancelText: "SA3", startup: 12, onHit: 2, onBlock: -5 }),
];

test("公式の表記を数値にする（符号・ダウン・幅・発生の範囲・空）", () => {
  assert.deepEqual(parseFrameText("+4", "advantage"), { value: 4, min: null, max: null, knockdown: false });
  assert.equal(parseFrameText("-1", "advantage").value, -1);
  assert.equal(parseFrameText("5", "advantage").value, 5);
  assert.deepEqual(parseFrameText("D", "advantage"), { value: null, min: null, max: null, knockdown: true });
  assert.deepEqual(parseFrameText("-12～-1", "advantage"), { value: -12, min: -12, max: -1, knockdown: false });
  assert.deepEqual(parseFrameText("-12~-1", "advantage"), { value: -12, min: -12, max: -1, knockdown: false });
  assert.equal(parseFrameText("2-4", "startup").value, 2);
  assert.equal(parseFrameText("", "advantage").value, null);
  assert.equal(parseFrameText(null, "startup").value, null);
  assert.equal(parseFrameText("全体 18", "startup").value, null);
  assert.equal(formatAdvantage("5"), "+5");
  assert.equal(formatAdvantage("2～13"), "+2～+13");
  assert.equal(formatAdvantage("D"), "D");
});

test("カウンターはヒット+2F、パニカンは+4F。ダウンはD、備考の個別性能を優先する", () => {
  assert.deepEqual(counterText(moves[0]), { text: "+6", overridden: false });
  assert.deepEqual(punishCounterText(moves[0]), { text: "+8", overridden: false });
  assert.deepEqual(punishCounterText(moves[1]), { text: "+11", overridden: true });
  assert.deepEqual(counterText(moves[1]), { text: "+5", overridden: false });
  assert.deepEqual(counterText(moves[2]), { text: "D", overridden: false });
  assert.deepEqual(punishCounterText(moves[3]), { text: "+5～+14", overridden: false });
  assert.deepEqual(counterText(move({ hitText: null, onHit: null })), { text: "", overridden: false });
});

test("確反マークは-4〜-5Fが light、-6F以下が heavy", () => {
  assert.equal(punishLevel({ onBlock: -3 }), null);
  assert.equal(punishLevel({ onBlock: -4 }), "light");
  assert.equal(punishLevel({ onBlock: -5 }), "light");
  assert.equal(punishLevel({ onBlock: -6 }), "heavy");
  assert.equal(punishLevel({ onBlock: null }), null);
});

test("技名（カタカナ・ひらがな）とコマンドで絞り、カテゴリ・確反・キャンセルと3つの並べ替え", () => {
  assert.equal(normalizeQuery(" ニー アッパー "), "にーあっぱー");
  assert.deepEqual(searchMoves(moves, { query: "ニーアッパー" }).map((entry) => entry.sortOrder), [3]);
  assert.deepEqual(searchMoves(moves, { query: "にーあっぱー" }).map((entry) => entry.sortOrder), [3]);
  assert.deepEqual(searchMoves(moves, { query: "623" }).map((entry) => entry.sortOrder), [3]);
  assert.deepEqual(searchMoves(moves, { category: "special" }).map((entry) => entry.sortOrder), [3, 5]);
  assert.deepEqual(searchMoves(moves, { punishableOnly: true }).map((entry) => entry.sortOrder), [3, 4, 5]);
  assert.deepEqual(searchMoves(moves, { cancelableOnly: true }).map((entry) => entry.sortOrder), [1, 5]);
  assert.deepEqual(searchMoves(moves, { sort: "startup" }).map((entry) => entry.sortOrder), [1, 3, 5, 4, 2]);
  assert.deepEqual(searchMoves(moves, { sort: "block" }).map((entry) => entry.sortOrder), [2, 1, 5, 4, 3]);
});

test("レシピの先頭の技を探す。溜めなど2語の一致を優先し、立ちの5は省略してよい", () => {
  assert.equal(starterMove("溜め 5強P xx 623強K", moves)?.sortOrder, 2);
  assert.equal(starterMove("5弱P > 5弱P", moves)?.sortOrder, 1);
  assert.equal(starterMove("前ステ 5弱P", moves), null);
  assert.equal(defaultStateName("5弱P > 5弱P xx 623強K", moves), "強ニーアッパー締め後");
  assert.equal(defaultStateName("前ステ 投げ", moves), null);
});

test("投入用のJSONを表の列に直し、問題があれば errors に入れる", () => {
  const { row, errors } = toMoveRow({
    category: "special", name: "強 ニーアッパー", command: "623強K", startup: "9", active: "9-12", recovery: "40",
    hit: "D", block: "-30", cancel: "", damage: "1200", notes: "対空", punishCounterOverride: null,
  }, 3);
  assert.deepEqual(errors, []);
  assert.equal(row.sort_order, 3);
  assert.equal(row.startup, 9);
  assert.equal(row.hit_knockdown, true);
  assert.equal(row.on_hit, null);
  assert.equal(row.on_block, -30);
  assert.equal(row.cancel_text, null);
  assert.equal(row.hit_text, "D");
  assert.match(toMoveRow({ category: "ultimate", name: "x" }, 1).errors.join("\n"), /カテゴリ/);
  assert.match(toMoveRow({ category: "normal", name: "x", hit: "よろけ" }, 1).errors.join("\n"), /ヒット「よろけ」/);
  assert.match(toMoveRow({ category: "normal", name: "x", startup: "D" }, 1).errors.join("\n"), /発生/);
  assert.match(toMoveRow({ category: "normal", name: "" }, 1).errors.join("\n"), /技名/);
});

test("投入スクリプトは検証してから入れ替えのSQLを出し、問題があれば一覧を出して止まる", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("../scripts/sf6-moves-sql.mjs", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "sf6-moves-"));
  const run = (file: string, ...flags: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(process.execPath, [script, ...flags, file], (error, stdout, stderr) => done({ code: error ? Number(error.code) : 0, stdout, stderr }));
  });
  const input = {
    character: "テスト'キャラ", dataVersion: "Ver.0.0001", sourceUrl: "https://www.streetfighter.com/6/ja-jp/character/test/frame", checkedOn: "2026-10-12",
    moves: [
      { category: "normal", name: "立ち弱P", command: "5弱P", startup: "4", hit: "+4", block: "-1", cancel: "C" },
      { category: "super", name: "SA1", command: "236236K ディレイ", startup: "9", hit: "D", block: "-30", punishCounterOverride: null },
    ],
  };
  const good = join(dir, "good.json");
  await writeFile(good, JSON.stringify(input));
  const ok = await run(good);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /insert into public\.sf6_move_sets .*\n.*values \('テスト''キャラ', 'Ver\.0\.0001'/);
  assert.match(ok.stdout, /delete from public\.sf6_moves where character = 'テスト''キャラ';/);
  assert.match(ok.stdout, /\('テスト''キャラ', 1, 'normal', '立ち弱P', '5弱P', '4', null, null, '\+4', '-1', 'C',/);
  assert.match(ok.stdout, /, 9, null, true, -30, null, null\);\n$/);
  assert.match(ok.stderr, /ディレイ は文字のまま/);
  assert.match(ok.stderr, /normal 1 \/ unique 0 \/ special 0 \/ super 1/);
  assert.match((await run(good, "--dry-run")).stdout, /raise exception 'DRYRUN: % moves'/);
  const bad = join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ ...input, sourceUrl: "https://example.com/", moves: [{ category: "ultimate", name: "x", hit: "よろけ" }] }));
  const failed = await run(bad);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /sourceUrl/);
  assert.match(failed.stderr, /カテゴリ「ultimate」/);
  assert.match(failed.stderr, /ヒット「よろけ」/);
});
