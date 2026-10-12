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
