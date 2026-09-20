import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quiz view can be opened from and closed back to the URL", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /URLSearchParams\(window\.location\.search\)\.get\("view"\) === "quiz"/);
  assert.match(source, /url\.searchParams\.set\("view", "quiz"\)/);
  assert.match(source, /url\.searchParams\.delete\("view"\)/);
  assert.match(source, /onExit=\{\(\) => setQuizOpen\(false\)\}/);
  assert.match(source, /onRecorded=\{reload\}/);
});
