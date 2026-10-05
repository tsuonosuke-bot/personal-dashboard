import { readdir, readFile } from "node:fs/promises";

/**
 * Idea画面（/compass/）のスクリプト全体。入口の `public/app.js` と、機能ごとに分けた
 * `public/compass/*.js` を連結して返す。UIのテストはソースを文字列で検査するので、
 * どのモジュールに置かれているかを気にせず書けるようにする。
 */
export async function readCompassScript(): Promise<string> {
  const directory = new URL("../public/compass/", import.meta.url);
  const modules = (await readdir(directory)).filter((name) => name.endsWith(".js")).sort();
  const sources = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ...modules.map((name) => readFile(new URL(name, directory), "utf8")),
  ]);
  return sources.join("\n");
}
