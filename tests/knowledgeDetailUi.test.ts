import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("knowledge detail shows priority and its review interval", async () => {
  const source = await readFile(
    new URL("../src/components/KnowledgeDetailModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<dt>優先度<\/dt>/);
  assert.match(source, /PRIORITY_INTERVAL_HINTS\[knowledge\.priority\]/);
});

test("quiz source detail opens the knowledge editor and syncs the saved result", async () => {
  const source = await readFile(
    new URL("../src/components/QuizView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onEdit=\{\(\) => openEdit\(detail\)\}/);
  assert.match(source, /<KnowledgeFormModal/);
  assert.match(source, /const updated = await onKnowledgeUpdate\(/);
  assert.match(source, /quiz\.syncKnowledgeResult\(updated\)/);
});
