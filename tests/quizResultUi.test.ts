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

test("復習結果は正常な採点を残し、失敗した問題にだけ原因と保存状態を表示する", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hook, /setResults\(graded\.results\)/);
  assert.match(hook, /setFailures\(graded\.failures\.map/);
  assert.match(hook, /setStage\("results"\)/);
  assert.match(view, /quiz\.failures\.find\(\(item\) => item\.index === questionIndex\)/);
  assert.match(view, /正常な問題の採点は完了しています/);
  assert.match(view, /<h3>原因<\/h3>/);
  assert.match(view, /この問題の採点結果は保存されていません/);
  assert.match(view, /保存成否を確認できませんでした/);
});

test("各問題を採点と復習履歴の対象外にできる", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.match(view, /この問題は採点・復習履歴に記録しない/);
  assert.match(view, /この問題は採点せず、復習履歴にも記録していません/);
  assert.match(hook, /questions\.flatMap\(\(q, questionIndex\) => skipped\[q\.id\] \? \[\] :/);
  assert.match(hook, /if \(submitted\.length === 0\)/);
  assert.match(hook, /index: submitted\[failure\.index\]\?\.questionIndex/);
});

test("出題生成エラーは正常な問題を止めず、件数と原因を表示する", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hook, /requestedCount: requested, generationFailures: generationErrors/);
  assert.match(view, /問は生成エラーのためスキップしました/);
  assert.match(view, /追加のAI再生成は行っていません/);
  assert.match(view, /<summary>エラー原因を表示<\/summary>/);
  assert.match(view, /failure\.position.*failure\.category.*failure\.reason/s);
});
