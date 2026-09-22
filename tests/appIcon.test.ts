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

test("iOSアイコンの下地は黄色で、Android・ブラウザ用は既存の緑を保つ", async () => {
  const appleIcon = await readFile(new URL("../public/static/apple-touch-icon.svg", import.meta.url), "utf8");
  assert.match(appleIcon, /<rect width="512" height="512" fill="#f3c218"\/>/);

  const manifest = JSON.parse(await readFile(new URL("../public/static/manifest.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual(manifest.icons.map((icon: { src: string }) => icon.src), ["/icon.svg", "/icon-maskable.svg"]);
  const icon = await readFile(new URL("../public/static/icon.svg", import.meta.url), "utf8");
  assert.match(icon, /fill="#2f6750"/);
});

test("ホーム画面へ追加する各画面がapple-touch-iconを指す", async () => {
  for (const page of APP_PAGES) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/, page);
    assert.ok(!/rel="apple-touch-icon"[^>]*icon\.svg/.test(html), `${page} はSVGをiOSアイコンに使わない`);
  }
});
