import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("復習結果にナレッジID・分類と新規タブの管理導線を表示する", async () => {
  const [source, appSource] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /<dt>ナレッジID<\/dt>/);
  assert.match(source, /<h3>あなたの回答<\/h3>/);
  assert.match(source, /job\.answers\[question\.id\]/);
  assert.match(source, /hasUserAnswer \? userAnswer : "（未回答）"/);
  assert.match(source, /dashboardRoutePath\(window\.location\.href/);
  assert.match(source, /href=\{knowledgeHref\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /詳細・編集を新しいタブで開く/);
  assert.match(source, /本文・タグ・分類の編集も行えます/);
  assert.match(appSource, /onEdit=\{\(\) => openEdit\(selected\)\}/);
  assert.match(appSource, /onArchive=\{\(\) => void archiveKnowledge\(selected\)\}/);
});

test("復習結果は正常な採点を残し、失敗した問題にだけ原因と保存状態を表示する", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hook, /results: graded\.results,/);
  assert.match(hook, /failures: graded\.failures\.map/);
  assert.match(hook, /setStage\("results"\)/);
  assert.match(view, /job\.failures\.find\(\(item\) => item\.index === questionIndex\)/);
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
  assert.match(hook, /job\.questions\.flatMap\(\(q, questionIndex\) => job\.skipped\[q\.id\] \? \[\] :/);
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

test("採点結果で習熟度・優先度を画面遷移なしに変更できる", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.match(view, /<span>習熟度<\/span>/);
  assert.match(view, /<span>優先度<\/span>/);
  assert.match(view, /MASTERY_ORDER\.map/);
  assert.match(view, /changeResultField\(result, \{\s*mastery:/);
  assert.match(view, /changeResultField\(result, \{\s*priority:/);
  assert.doesNotMatch(view, /の分類`\}/);
  assert.match(view, /onKnowledgeUpdate\(result\.id, result\.content_version, changes\)/);
  assert.match(hook, /mastery: updated\.mastery/);
  assert.match(hook, /category: updated\.category/);
});

test("優先度の説明は各問題に繰り返さず、結果画面に一度だけ出す", async () => {
  const view = await readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(view, /PRIORITY_INTERVAL_HINTS/);
  assert.equal(view.match(/優先度の倍率で計算し直します/g)?.length, 1);
  const noteIndex = view.indexOf("quiz-results-note");
  const listIndex = view.indexOf('<ul className="quiz-result-list">');
  assert.ok(noteIndex > 0 && noteIndex < listIndex);
});

test("復習・英会話・タグ・ダッシュボードの切替時にスクロール位置を先頭へ戻す", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /const view = showQuiz \? "quiz" : showSpeaking \? "speaking" : showLog \? "log" : showInsights \? "insights" : showTags \? "tags" : "dashboard";/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(0, 0\);[\s\S]*?\}, \[view\]\);/);
  assert.ok(app.indexOf("window.scrollTo(0, 0)") < app.indexOf("if (showQuiz) {"));
});

test("採点結果から確認つきでアーカイブし、同じ画面で元に戻せる", async () => {
  const view = await readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8");

  assert.match(view, /window\.confirm\(`「\$\{result\.title\}」をアーカイブしますか？/);
  assert.match(view, /saveResultChange\(result, \{ archived: true \}, "アーカイブしました。"\)/);
  assert.match(view, /saveResultChange\(result, \{ archived: false \}, "復元しました。"\)/);
  assert.match(view, /onKnowledgeUpdate\(result\.id, result\.content_version, changes\)/);
  assert.match(view, /const editDisabled = saving \|\| archived;/);
  assert.match(view, /アーカイブ済み/);
});

test("採点をバックグラウンドで進め、待つ間に次の復習へ進める", async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL("../src/components/QuizView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useQuiz.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(hook, /"grading" \| "results"/);
  assert.match(hook, /void runGrading\(job\)/);
  assert.match(hook, /startQuiz\(categories, limit, format, mode, gradingIds\)/);
  assert.match(hook, /重複記録はDB側が防ぐ/);
  assert.match(view, /待つ間に次の復習を始める/);
  assert.match(view, /解答中の問題に戻る/);
  assert.match(view, /<GradingJobsBanner jobs=\{otherJobs\}/);
  assert.match(view, /採点中の問題があります。/);
});
