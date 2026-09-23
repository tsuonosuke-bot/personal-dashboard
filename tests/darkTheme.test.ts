import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PAGES = ["index.html", "compass/index.html", "habits/index.html", "writing/index.html", "projects/index.html", "status/index.html"];

test("generated dark stylesheets are up to date with the light stylesheets", () => {
  const pkg = JSON.parse(execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('package.json','utf8'))"]).toString());
  const args = String(pkg.scripts["theme:check"]).split(" ").slice(1);
  assert.doesNotThrow(() => execFileSync("node", args, { stdio: "pipe" }));
});

test("every dashboard page resolves the theme before its stylesheets and offers the switcher", async () => {
  for (const page of PAGES) {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
    const script = html.indexOf('<script src="/theme.js"></script>');
    const firstStylesheet = html.indexOf('<link rel="stylesheet"');
    assert.ok(script > 0 && script < firstStylesheet, page);
    for (const [, name] of html.matchAll(/<link rel="stylesheet" href="\/([a-z-]+)\.css" \/>/g)) {
      if (name.endsWith(".dark")) continue;
      assert.match(html, new RegExp(`href="/${name}\\.css" />\\s*<link rel="stylesheet" href="/${name}\\.dark\\.css" />`), `${page}: ${name}`);
    }
    assert.match(html, /<select data-theme-select aria-label="表示テーマ"><option value="system">自動<\/option><option value="light">ライト<\/option><option value="dark">ダーク<\/option><\/select>/, page);
  }
});

test("theme script follows the OS unless light or dark is chosen, and keeps the choice shared", async () => {
  const script = await readFile(new URL("../public/static/theme.js", import.meta.url), "utf8");
  assert.match(script, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(script, /const KEY = "dashboard-theme";/);
  assert.match(script, /preference === "system" \? \(media && media\.matches \? "dark" : "light"\) : preference/);
  assert.match(script, /window\.addEventListener\("storage"/);
  assert.match(script, /root\.style\.colorScheme = theme;/);
  assert.match(script, /if \(scheme\) scheme\.content = theme;/);
  assert.match(script, /meta\.content = theme === "dark" \? DARK_THEME_COLOR : meta\.dataset\.lightColor/);
});
