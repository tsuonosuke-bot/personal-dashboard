import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("復習結果にナレッジID・分類と新規タブの管理導線を表示する", async () => {
  const [source, appSource] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /<dt>ナレッジID<\/dt>/);
  assert.match(source, /<dt>分類<\/dt>/);
  assert.match(source, /\{result\.category\}/);
  assert.match(source, /<h3>あなたの回答<\/h3>/);
  assert.match(source, /quiz\.answers\[question\.id\]/);
  assert.match(source, /hasUserAnswer \? userAnswer : "（未回答）"/);
  assert.match(source, /dashboardRoutePath\(window\.location\.href/);
  assert.match(source, /href=\{knowledgeHref\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /詳細・編集を新しいタブで開く/);
  assert.match(source, /習熟度の変更やアーカイブも行えます/);
  assert.match(appSource, /onEdit=\{\(\) => openEdit\(selected\)\}/);
  assert.match(appSource, /onArchive=\{\(\) => void archiveKnowledge\(selected\)\}/);
});
