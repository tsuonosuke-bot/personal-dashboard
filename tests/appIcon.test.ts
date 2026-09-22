import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_PAGES = [
  "../public/index.html",
  "../public/compass/index.html",
  "../public/habits/index.html",
  "../public/projects/index.html",
  "../public/writing/index.html",
];

test("iOSのホーム画面アイコンはPNGで配信する", async () => {
  const png = await readFile(new URL("../public/static/apple-touch-icon.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
});

test("iOS・Android・ブラウザのアイコンは同じ黄色地のPを使う", async () => {
  const marks = await Promise.all(["apple-touch-icon.svg", "icon.svg", "icon-maskable.svg"].map(async (name) => {
    const svg = await readFile(new URL(`../public/static/${name}`, import.meta.url), "utf8");
    assert.match(svg, /fill="#f3c218"/, name);
    assert.match(svg, /fill="#245949"/, name);
    assert.ok(!svg.includes("#2f6750"), `${name} に旧アイコンの緑地が残っている`);
    return svg;
  }));
  assert.ok(marks.every((svg) => /fill-rule="evenodd"/.test(svg)), "Pの抜き文字をevenoddで描く");

  const manifest = JSON.parse(await readFile(new URL("../public/static/manifest.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual(manifest.icons.map((icon: { src: string; purpose: string }) => [icon.src, icon.purpose]), [
    ["/icon-192.png", "any"],
    ["/icon-512.png", "any"],
    ["/icon-maskable-512.png", "maskable"],
    ["/icon.svg", "any"],
    ["/icon-maskable.svg", "maskable"],
  ]);
});

test("Android用PNGアイコンはインストール要件のサイズで配信する", async () => {
  for (const [name, expectedSize] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512]] as const) {
    const png = await readFile(new URL(`../public/static/${name}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name);
    assert.equal(png.readUInt32BE(16), expectedSize, `${name} width`);
    assert.equal(png.readUInt32BE(20), expectedSize, `${name} height`);
  }
});

test("認証付きサイトでもAndroidがPWAマニフェストを取得できる", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials" \/>/);
});

test("ホーム画面へ追加する各画面がapple-touch-iconを指す", async () => {
  for (const page of APP_PAGES) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/, page);
    assert.ok(!/rel="apple-touch-icon"[^>]*icon\.svg/.test(html), `${page} はSVGをiOSアイコンに使わない`);
  }
});
