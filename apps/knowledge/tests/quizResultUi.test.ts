import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("復習・英会話・タグ・ダッシュボードの切替時にスクロール位置を先頭へ戻す", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /const view = showQuiz \? "quiz" : showSpeaking \? "speaking" : showLog \? "log" : organize \? "organize" : "dashboard";/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(0, 0\);[\s\S]*?\}, \[view\]\);/);
  assert.ok(app.indexOf("window.scrollTo(0, 0)") < app.indexOf("if (showQuiz) {"));
});

test("復習画面はAIを呼ばず、キューから出題して1問ずつ回答を送る", async () => {
  const [view, session] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReviewSession.ts", import.meta.url), "utf8"),
  ]);
  assert.match(session, /serveReviewQuestions\(limit, categories\)/);
  assert.match(session, /submitReviewAnswer\(current\.id, answer\)/);
  assert.doesNotMatch(session + view, /startQuiz|gradeQuiz|api\/quiz\//);
  // 答えずに飛ばした問題は送らず、次の復習でまた出る
  assert.match(session, /status: "skipped"/);
  assert.match(view, /答えずに飛ばすと、この問題は次の復習でまた出ます/);
  // 採点結果の画面は無く、学習ログへ案内する
  assert.match(view, /学習ログで結果を見る/);
  assert.doesNotMatch(view, /KnowledgeFormModal|InsightNotes/);
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
