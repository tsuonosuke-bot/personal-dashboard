import { readClientScript } from "./clientScript.ts";

/**
 * Idea画面（/compass/）の入口と静的import先を連結して返す。
 * UIのテストを、関数の置かれたファイル名に依存させない。
 */
export function readCompassScript(): Promise<string> {
  return readClientScript("app");
}
