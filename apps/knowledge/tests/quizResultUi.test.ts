import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("復習・英会話・検索・タグ・ダッシュボードの切替時にスクロール位置を先頭へ戻す", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /const view = showQuiz \? "quiz" : showSpeaking \? "speaking" : showLog \? "log" : showSearch \? "search" : organize \? "organize" : "dashboard";/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(0, 0\);[\s\S]*?\}, \[view\]\);/);
  assert.ok(app.indexOf("window.scrollTo(0, 0)") < app.indexOf("if (showQuiz) {"));
});

test("復習画面はAIを呼ばず、キューの上から解き続け、いつでも終えられる", async () => {
  const [view, session] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReviewSession.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(session + view, /startQuiz|gradeQuiz|api\/quiz\//);
  // 問題数やカテゴリは選ばせない（ノートの復習だけ、そのノートのナレッジに絞る）
  assert.match(session, /serveReviewQuestions\(SERVE_BATCH, \[\], knowledgeIds\)/);
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
  assert.match(view, /AIによる採点と講評は、1時間以内に学習ログへ届きます/);
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

test("答え合わせ画面に学習ログと同じ操作（示唆・あとで深掘り・習熟度・優先度・詳細・アーカイブ）を出し、そのまま次へ進める", async () => {
  const [view, app, parts] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ReviewLogParts.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /<ReviewView[\s\S]*?onKnowledgeUpdate=\{updateKnowledge\}[\s\S]*?insightStore=\{insightStore\}[\s\S]*?insightGroupStore=\{insightGroupStore\}/);
  assert.match(app, /<ReviewView[\s\S]*?quizLog=\{quizLog\}/);
  assert.match(view, /item=\{knowledgeById\.get\(session\.feedback\.question\.knowledge_id\)\}/);
  // 学習ログと同じ部品を使う
  assert.match(view, /<ReviewResultActions[\s\S]*?item=\{item\}[\s\S]*?insightStore=\{insightStore\}/);
  assert.match(parts, /<DeepDiveInbox knowledgeId=\{item\.id\}/);
  assert.match(parts, /<InsightNotes knowledgeId=\{item\.id\}/);
  // 楽観ロックの版を付けて1件だけ更新する
  assert.match(parts, /onKnowledgeUpdate\(target\.id, target\.content_version, changes\)/);
  // アーカイブは確認し、採点前なら回答が記録されなくなることを伝え、元に戻せる
  assert.match(view, /archiveWarning=\{result \? undefined : "採点前にアーカイブしたままだと、この回答は記録されません。"\}/);
  assert.match(parts, /今後の復習に出題されなくなります。\$\{warning\}/);
  assert.match(parts, /save\(\{ archived: false \}, "復元しました。"\)/);
  // 詳細は読み取り専用で、復習画面の上に開く
  assert.match(view, /onOpenDetail=\{\(item\) => setDetailId\(item\.id\)\}/);
  assert.match(view, /<KnowledgeDetailModal[\s\S]*?mutating=\{false\}/);
  // 操作後も「次の問題へ」は残る
  assert.match(view, /次の問題へ →<\/button>[\s\S]*?<ReviewResultActions/);
});

test("答え合わせ画面は、その知識に付いているタグを表示する（無いときは未設定）", async () => {
  const [view, css] = await Promise.all([
    readFile(new URL("../src/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  const feedback = view.slice(view.indexOf("function ReviewFeedbackCard"));
  // 結果欄（dl）の中に、知識項目があるときだけタグの行を出す
  assert.match(feedback, /<dl className="review-result-body">[\s\S]*\{item && \([\s\S]*<dt>タグ<\/dt>[\s\S]*<\/dl>/);
  // 自分で付けたタグと自動タグ（#93）を1つの並びで出し、無いときは「未設定」
  assert.match(feedback, /<TagChips item=\{item\} emptyLabel="未設定" \/>/);
  // 質問の表示（回答前）にはタグを出さない: 答えのヒントになりうる
  const question = view.slice(view.indexOf("function ReviewQuestionCard"), view.indexOf("function ReviewFeedbackCard"));
  assert.doesNotMatch(question, /\.tags|<dt>タグ/);
  assert.match(css, /\.review-feedback-tags \{ display: flex; flex-wrap: wrap;/);
});
