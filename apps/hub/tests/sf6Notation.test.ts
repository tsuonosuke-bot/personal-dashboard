import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appendFragment, appendToken, frequentFragments, parseNotation, removeLastToken } from "../public/sf6-notation.js";

function press(...keys: string[]) {
  return keys.reduce((text, key) => appendToken(text, key), "");
}

test("パレットの方向・コマンド・ジャンプは続くボタンと1語にまとまる", () => {
  assert.equal(press("2", "中K", ">", "DR", "5", "中P", ">", "2", "強P", "xx", "2", "3", "6", "強P"), "2中K > DR 5中P > 2強P xx 236強P");
  assert.equal(press("J", "強K", ">", "623", "PP", "SA3"), "J強K > 623PP SA3");
  // ボタンのあとに押した方向は新しい語になる
  assert.equal(press("強P", "2", "中K"), "強P 2中K");
});

test("1つ戻すはボタン→方向1つ→語の順に消す", () => {
  let text = "2中K xx 236強P";
  text = removeLastToken(text);
  assert.equal(text, "2中K xx 236");
  text = removeLastToken(text);
  assert.equal(text, "2中K xx 23");
  assert.equal(removeLastToken("2中K xx"), "2中K");
  assert.equal(removeLastToken("J強K"), "J");
  assert.equal(removeLastToken("中P"), "");
  assert.equal(removeLastToken(""), "");
});

test("レシピを矢印・ボタン・つなぎに分け、読めない語は文字のまま残す", () => {
  const parts = parseNotation("5中P > 236PP xx SA2 ディレイ");
  assert.deepEqual(parts[0], { type: "command", jump: false, arrows: [], button: "中P", strength: "medium", limb: "punch" });
  assert.equal(parts[1].type, "link");
  assert.deepEqual(parts[2], { type: "command", jump: false, arrows: ["↓", "↘", "→"], button: "PP", strength: "od", limb: "punch" });
  assert.deepEqual(parts[4], { type: "link", label: "SA2", kind: "sa", title: "SA2" });
  assert.deepEqual(parts[5], { type: "text", text: "ディレイ" });
});

test("よく使う出だしは>またはxxで区切った最初の1〜2区間から多い順（同数なら短い順）に拾う", () => {
  const fragments = frequentFragments([
    "2中K > DR 5中P > 2強P xx 236強P",
    "2中K > DR 5中P > 5強P",
    "2中K xx 214強K",
    "5強P",
  ]);
  assert.deepEqual(fragments.slice(0, 2), ["2中K >", "2中K > DR 5中P >"]);
  assert.ok(fragments.includes("2中K xx"));
  assert.equal(appendFragment("", "2中K > DR 5中P >"), "2中K > DR 5中P >");
});

test("コンボの入力欄はパレットとプレビューを持ち、文字の直接編集も残す", async () => {
  const [script, help] = await Promise.all([
    readFile(new URL("../public/sf6.js", import.meta.url), "utf8"),
    readFile(new URL("../public/help/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(script, /type: "notation"/);
  assert.match(script, /data-palette="backspace"/);
  assert.match(script, /文字で直接編集/);
  assert.match(help, /<section id="sf6"/);
});
