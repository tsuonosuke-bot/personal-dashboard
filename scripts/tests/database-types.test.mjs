import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../database-types.mjs", import.meta.url));
const snapshot = fileURLToPath(
  new URL("../../packages/database-types/database.types.ts", import.meta.url),
);
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("type importer compares LF and CRLF identically without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "database-types-"));
  try {
    const input = join(dir, "download.ts");
    const original = readFileSync(snapshot, "utf8");
    writeFileSync(input, original.replace(/\r?\n/g, "\r\n"));
    const result = run(["--input", input, "--check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(snapshot, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid downloads, credentials and drift cannot overwrite the snapshot during check", () => {
  const dir = mkdtempSync(join(tmpdir(), "database-types-"));
  try {
    const input = join(dir, "download.ts");
    const original = readFileSync(snapshot, "utf8");
    for (const source of [
      "<html>login</html>",
      original + "\n// sb_secret_example",
      original + "\n// schema drift",
    ]) {
      writeFileSync(input, source);
      const result = run(["--input", input, "--check"]);
      assert.equal(result.status, 1);
      assert.equal(readFileSync(snapshot, "utf8"), original);
      assert.doesNotMatch(result.stdout + result.stderr, /sb_secret_example/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown flags and missing input are rejected before network access", () => {
  for (const args of [["--bogus"], ["--input"], ["--input", "--check"]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});
