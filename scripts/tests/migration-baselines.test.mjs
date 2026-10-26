import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateBaselineLedger } from "../migration-baselines.mjs";

const catalog = JSON.parse(await readFile(new URL("../migration-catalog.json", import.meta.url)));
const saved = JSON.parse(await readFile(new URL("../migration-baselines.json", import.meta.url)));

test("every archived baseline needs one assessment, including unresolved history", () => {
  assert.equal(validateBaselineLedger(catalog, saved), 5);
  for (const edit of [
    (ledger) => ledger.baselines.pop(),
    (ledger) => ledger.baselines.push(structuredClone(ledger.baselines[0])),
    (ledger) => (ledger.baselines[0].path = "apps/finance/supabase/migrations/new.sql"),
  ]) {
    const ledger = structuredClone(saved);
    edit(ledger);
    assert.throws(() => validateBaselineLedger(catalog, ledger), /missing|unknown|duplicate/);
  }
});

test("an unresolved baseline cannot be silently marked applied or given a guessed version", () => {
  for (const change of [
    { status: "applied" },
    { version: "20261026000000" },
    { status: "identified" },
    { status: "identified", version: "202610260001", name: "local_filename" },
  ]) {
    const ledger = structuredClone(saved);
    Object.assign(
      ledger.baselines.find((entry) => entry.history.status === "unresolved").history,
      change,
    );
    assert.throws(() => validateBaselineLedger(catalog, ledger), /unknown|invent|actual/);
  }
});

test("related migration evidence never replaces the unresolved initial history", () => {
  const ledger = structuredClone(saved);
  const recurring = ledger.baselines.find((entry) => entry.relatedHistory);
  assert.equal(recurring.history.status, "unresolved");
  assert.equal(recurring.history.version, null);
  assert.equal(recurring.relatedHistory[0].version, "20261009020520");
  // Recorded DB versions can differ from local filenames; no renaming/replay is implied.
  assert.equal(validateBaselineLedger(catalog, ledger), 5);
  recurring.relatedHistory[0].note = "";
  assert.throws(() => validateBaselineLedger(catalog, ledger), /related history/);
});
