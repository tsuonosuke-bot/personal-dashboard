import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("復習・英会話・タグ・ダッシュボードの切替時にスクロール位置を先頭へ戻す", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /const view = showQuiz \? "quiz" : showSpeaking \? "speaking" : showLog \? "log" : organize \? "organize" : "dashboard";/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(0, 0\);[\s\S]*?\}, \[view\]\);/);
  assert.ok(app.indexOf("window.scrollTo(0, 0)") < app.indexOf("if (showQuiz) {"));
});

test("復習画面はAIを呼ばず、キューの上から解き続け、いつでも終えられる", async () => {
  const [view, session] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReviewSession.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(session + view, /startQuiz|gradeQuiz|api\/quiz\//);
  // 問題数やカテゴリは選ばせない
  assert.match(session, /serveReviewQuestions\(SERVE_BATCH\)/);
  assert.doesNotMatch(view, /LIMIT_OPTIONS|quiz-category-select/);
  // 手元の問題を使い切ったら次を受け取り、無くなったら終える
  assert.match(session, /if \(await loadNext\(\)\) setStage\("question"\);\s+else finish\(true\);/);
  // 飛ばした問題は出題待ちのまま残るので、この回では出さない
  assert.match(session, /served\.filter\(\(question\) => !seen\.current\.has\(question\.id\)\)/);
  assert.match(view, /終了する/);
  assert.match(view, /いつ終えても大丈夫です/);
});

test("回答した直後に想定解で答え合わせし、AIの採点は学習ログへ届く", async () => {
  const [view, session] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReviewSession.ts", import.meta.url), "utf8"),
  ]);
  assert.match(session, /submitReviewAnswer\(current\.id, answer\)/);
  assert.match(session, /setStage\("feedback"\)/);
  assert.match(view, /result\?\.correct_answer \?\? accepted\.expected_answer/);
  assert.match(view, /AIによる採点と講評は、15分以内に学習ログへ届きます/);
  assert.match(view, /次の問題へ/);
  // 採点結果の画面は無く、学習ログへ案内する
  assert.match(view, /学習ログで結果を見る/);
  assert.doesNotMatch(view, /KnowledgeFormModal|InsightNotes/);
});

test("おかしな問題は確認のうえ取り下げ、記録せずに次へ進む", async () => {
  const [view, session] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReviewSession.ts", import.meta.url), "utf8"),
  ]);
  assert.match(view, /おかしな問題を報告/);
  assert.match(view, /window\.confirm\("この問題を取り下げますか？/);
  assert.match(session, /await discardReviewQuestion\(current\.id\);[\s\S]*?status: "discarded"[\s\S]*?await advance\(\);/);
});

test("復習画面から手動で採点と問題生成ができ、上限到達時は生成ボタンを止める", async () => {
  const [view, summary] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ReviewQueueSummary.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(view, /runReviewBatch\(kind\)/);
  assert.match(view, /今すぐ採点する/);
  assert.match(view, /今すぐ問題を作る/);
  assert.match(view, /disabled=\{batchBusy !== null \|\| queueStatus\?\.queue_full === true\}/);
  assert.match(summary, /新しい問題の追加を止めています/);
});
