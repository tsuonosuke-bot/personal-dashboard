// An offline evidence ledger, never an instruction to execute or repair a migration.
export function validateBaselineLedger(catalog, ledger) {
  const fail = (message) => {
    throw new Error(`Baseline ledger: ${message}`);
  };
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const strings = (value) => Array.isArray(value) && value.every(text);
  const validHistory = (value) =>
    value && /^\d{14}$/.test(value.version ?? "") && /^[a-z][a-z0-9_]*$/.test(value.name ?? "");
  if (
    ledger?.schemaVersion !== 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ledger.observedOn ?? "") ||
    !text(ledger.environment) ||
    !/^[a-f0-9]{40}$/.test(ledger.sourceCommit ?? "") ||
    !Number.isInteger(ledger.historyRows) ||
    ledger.historyRows < 0 ||
    !Array.isArray(ledger.baselines)
  ) {
    fail("invalid observation metadata.");
  }
  const expected = new Set(
    catalog.filter((entry) => entry.kind === "baseline-snapshot").map((entry) => entry.path),
  );
  const seen = new Set();
  for (const entry of ledger.baselines) {
    if (!expected.has(entry.path) || seen.has(entry.path)) {
      fail(`unknown or duplicate path: ${entry.path}`);
    }
    seen.add(entry.path);
    const history = entry.history;
    if (!history || !text(history.evidence)) fail(`${entry.path}: missing history evidence.`);
    if (history.status === "identified") {
      if (!validHistory(history))
        fail(`${entry.path}: identified history needs its actual version/name.`);
    } else if (history.status === "unresolved") {
      if (history.version !== null || history.name !== null) {
        fail(`${entry.path}: unresolved history must not invent a version/name.`);
      }
    } else {
      fail(`${entry.path}: unknown history status.`);
    }
    if (
      !strings(entry.observedChecks) ||
      !entry.observedChecks.length ||
      !strings(entry.differences)
    ) {
      fail(`${entry.path}: describe current checks and differences separately.`);
    }
    if (
      entry.relatedHistory !== undefined &&
      (!Array.isArray(entry.relatedHistory) ||
        !entry.relatedHistory.every((item) => validHistory(item) && text(item.note)))
    ) {
      fail(`${entry.path}: invalid related history.`);
    }
  }
  for (const path of expected) {
    if (!seen.has(path)) fail(`${path}: missing history assessment.`);
  }
  return seen.size;
}
