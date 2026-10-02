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

test("学習ログの採点結果から、習熟度・優先度の変更、アーカイブ、詳細表示ができる", async () => {
  const [parts, view] = await Promise.all([
    readFile(new URL("../src/components/ReviewLogParts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/LearningLogView.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(parts, /onKnowledgeUpdate\(target\.id, target\.content_version, changes\)/);
  assert.match(parts, /window\.confirm\(`「\$\{item\.title\}」をアーカイブしますか？/);
  assert.match(parts, /save\(\{ archived: false \}, "復元しました。"\)/);
  assert.match(parts, /aria-label=\{`\$\{item\.title\}の習熟度`\}/);
  assert.match(parts, /aria-label=\{`\$\{item\.title\}の優先度`\}/);
  assert.match(view, /<KnowledgeDetailModal/);
  assert.match(view, /onOpenDetail=\{\(item\) => setDetailId\(item\.id\)\}/);
});
