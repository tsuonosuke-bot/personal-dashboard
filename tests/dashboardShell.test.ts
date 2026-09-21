import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Knowledge uses the shared dashboard shell and requested title", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>Knowledge — Personal Hub<\/title>/);
  assert.match(app, /<h1>Knowledge<\/h1>/);
  assert.match(app, /className="dashboard-switcher"/);
  assert.match(app, /SUPABASE LIVE/);
  assert.match(app, />Idea<\/a>/);
  assert.match(app, />Finance<\/a>/);
  assert.match(css, /width: min\(1240px, calc\(100% - 32px\)\)/);
  assert.match(css, /min-height: 68px/);
});
