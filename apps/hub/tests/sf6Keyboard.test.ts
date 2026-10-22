import assert from "node:assert/strict";
import test from "node:test";
import { createNotationKeyboard } from "../public/sf6-keyboard.js";

type KeyEvent = Parameters<ReturnType<typeof createNotationKeyboard>["keydown"]>[0];

function editor(initial = "") {
  let text = initial;
  const keyboard = createNotationKeyboard({ read: () => text, write: (value) => { text = value; } });
  const down = (key: string, options: Omit<KeyEvent, "key"> = {}) => keyboard.keydown({ key, ...options });
  const up = (key: string) => keyboard.keyup({ key });
  return { keyboard, down, up, text: () => text, tap: (key: string, options: Omit<KeyEvent, "key"> = {}) => {
    const handled = down(key, options);
    up(key);
    return handled;
  } };
}

test("矢印の同時押しは余分な方向を残さず斜め1つになり、波動コマンドを入力できる", () => {
  const input = editor();
  input.tap("ArrowDown");
  input.down("ArrowDown");
  input.down("ArrowRight");
  assert.equal(input.text(), "23");
  input.up("ArrowDown");
  input.up("ArrowRight");
  assert.equal(input.text(), "23");
  input.tap("ArrowRight");
  input.tap("o");
  assert.equal(input.text(), "236強P");

  const reverse = editor();
  reverse.down("ArrowLeft");
  reverse.down("ArrowUp");
  reverse.up("ArrowUp");
  reverse.up("ArrowLeft");
  reverse.tap("j");
  assert.equal(reverse.text(), "7弱K");
});

test("方向を押したまま攻撃しても、次の方向で完成済みの技を上書きしない", () => {
  const input = editor();
  input.down("ArrowDown");
  input.tap("k");
  input.down("ArrowRight");
  input.tap("u");
  assert.equal(input.text(), "2中K 3弱P");
});

test("数字・6ボタン・つなぎ・キャンセルで既存形式のレシピを組み立てる", () => {
  const input = editor();
  ["2", "k", " ", "r", "5", "i", " ", "2", "o", "x", "2", "3", "6", "o"].forEach((key) => input.tap(key));
  assert.equal(input.text(), "2中K > DR 5中P > 2強P xx 236強P");
  input.tap("Backspace");
  assert.equal(input.text(), "2中K > DR 5中P > 2強P xx 236");
  input.tap("Backspace");
  assert.equal(input.text(), "2中K > DR 5中P > 2強P xx 23");
  const attacks = editor();
  ["u", "i", "o", "j", "k", "l"].forEach((key) => attacks.tap(key));
  assert.equal(attacks.text(), "弱P 中P 強P 弱K 中K 強K");
});

test("ShiftでPP・KKとSA/CAを入力でき、数字の記号はキーボード配列に依存しない", () => {
  const input = editor();
  input.tap("2", { code: "Numpad2" });
  input.tap("3", { code: "Numpad3" });
  input.tap("6", { code: "Numpad6" });
  input.tap("O", { shiftKey: true });
  input.tap("L", { shiftKey: true });
  input.tap("!", { shiftKey: true, code: "Digit1" });
  input.tap('"', { shiftKey: true, code: "Digit2" });
  input.tap("#", { shiftKey: true, code: "Digit3" });
  input.tap("$", { shiftKey: true, code: "Digit4" });
  assert.equal(input.text(), "236PP KK SA1 SA2 SA3 CA");
  const links = editor();
  ["q", "l", "f", "p", "t", "c"].forEach((key) => links.tap(key));
  assert.equal(links.text(), "J強K DI パリィ 投げ TC");
});

test("長押しは既定動作を止めつつ追加せず、Tab・Enter・ブラウザ操作・IMEを奪わない", () => {
  const input = editor();
  input.down("ArrowDown");
  assert.equal(input.down("ArrowDown", { repeat: true }), true);
  input.up("ArrowDown");
  input.tap("u");
  assert.equal(input.down("u", { repeat: true }), true);
  assert.equal(input.down("Backspace", { repeat: true }), true);
  for (const key of ["Tab", "Enter", "Escape", "F5"]) assert.equal(input.tap(key), false);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    assert.equal(input.tap("r", options), false);
  }
  assert.equal(input.text(), "2弱P");
});

test("フォーカスを離れてリセットした後は押しっぱなしの方向が残らない", () => {
  const input = editor("5中P >");
  input.down("ArrowDown");
  input.keyboard.reset();
  input.tap("ArrowRight");
  input.tap("o");
  assert.equal(input.text(), "5中P > 26強P");
  input.down("ArrowLeft");
  input.tap("c", { ctrlKey: true });
  input.tap("ArrowUp");
  assert.equal(input.text(), "5中P > 26強P 48");
});
