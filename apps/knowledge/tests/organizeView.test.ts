import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("問い・示唆・タグは1つの整理ページのタブにまとめ、ダッシュボードの入口も1つにする", async () => {
  const [app, view] = await Promise.all([read("App.tsx"), read("components/OrganizeView.tsx")]);
  assert.match(app, /<OrganizeView/);
  assert.match(app, /onClick=\{\(\) => setOrganizeOpen\("questions"\)\}/);
  assert.doesNotMatch(app, /タグで探す/);
  assert.match(app, /replaceRoute\(tab \? \{ kind: "organize", tab, questionId: null \} : \{ kind: "dashboard" \}\)/);
  assert.match(view, /<InsightGroupsPanel/);
  assert.match(view, /<InsightListPanel/);
  assert.match(view, /<TagGroupsPanel/);
  // カテゴリ・タグ・問いの使い分けを画面上で示す
  assert.match(view, /<dt>カテゴリ<\/dt>/);
  assert.match(view, /<dt>タグ<\/dt>/);
  assert.match(view, /<dt>問い<\/dt>/);
});

test("URLで指定した問いを開く", async () => {
  const [view, panel] = await Promise.all([read("components/OrganizeView.tsx"), read("components/InsightGroupsPanel.tsx")]);
  assert.match(view, /initialGroupId=\{questionId\}/);
  assert.match(panel, /useState<number \| null>\(initialGroupId\)/);
});

test("示唆を書くときに問いを選べ、保存後にその問いへ入れる", async () => {
  const [notes, insights] = await Promise.all([read("components/InsightNotes.tsx"), read("hooks/useInsights.ts")]);
  assert.match(insights, /create: \(knowledgeId: string, body: string\) => Promise<KnowledgeInsight>/);
  assert.match(notes, /問いに入れる（任意）/);
  assert.match(notes, /const created = await store\.create\(knowledgeId, draft\);/);
  assert.match(notes, /groupStore\.addMember\(questionId, created\.id\)/);
  // 示唆だけ保存できたときに、同じ示唆を二重登録させない
  assert.match(notes, /示唆は保存しましたが、問いに入れられませんでした/);
});

test("既存の示唆も後から問いに入れられ、その場で新しい問いも作れる", async () => {
  const [notes, questions] = await Promise.all([read("components/InsightNotes.tsx"), read("components/InsightQuestions.tsx")]);
  assert.match(notes, /<QuestionPicker store=\{groupStore\} insightId=\{insight\.id\}/);
  assert.match(questions, /const created = await store\.create\(title, question\);\s+await store\.addMember\(created\.id, insightId\);/);
  // すでに入っている問いは選択肢に出さない
  assert.match(questions, /store\.groups\.filter\(\(group\) => !joined\.has\(group\.id\)\)/);
});

test("示唆には入っている問いを表示し、整理ページのその問いへ移動できる", async () => {
  const [notes, list, questions] = await Promise.all([
    read("components/InsightNotes.tsx"),
    read("components/InsightListPanel.tsx"),
    read("components/InsightQuestions.tsx"),
  ]);
  assert.match(notes, /<QuestionChips store=\{groupStore\} insightId=\{insight\.id\} \/>/);
  assert.match(list, /<QuestionChips store=\{groupStore\} insightId=\{note\.id\} \/>/);
  assert.match(questions, /\{ kind: "organize", tab: "questions", questionId: groupId \}/);
});

test("詳細・採点結果・整理ページで同じ問いの状態を共有する", async () => {
  const [app, quiz, detail] = await Promise.all([
    read("App.tsx"),
    read("components/QuizView.tsx"),
    read("components/KnowledgeDetailModal.tsx"),
  ]);
  assert.match(app, /const insightGroupStore = useInsightGroups\(\);/);
  assert.equal(app.match(/insightGroupStore=\{insightGroupStore\}/g)?.length, 3);
  assert.match(app, /groupStore=\{insightGroupStore\}/);
  assert.match(quiz, /groupStore=\{insightGroupStore\} compact/);
  assert.match(detail, /groupStore=\{insightGroupStore\}/);
});

test("AIがまとめたテーマを、問い文の下書きと根拠の示唆ごと問いとして保存できる", async () => {
  const [list, questions, groups, analyze] = await Promise.all([
    read("components/InsightListPanel.tsx"),
    read("components/InsightQuestions.tsx"),
    read("hooks/useInsightGroups.ts"),
    readFile(new URL("../functions/api/insights/analyze.ts", import.meta.url), "utf8"),
  ]);
  assert.match(analyze, /required: \["title", "guiding_question", "summary", "importance", "insight_ids"\]/);
  assert.match(list, /<ThemeToQuestion[\s\S]*?guidingQuestion=\{theme\.guiding_question\}[\s\S]*?insightIds=\{related\.map\(\(item\) => item\.id\)\}/);
  // 保存前にテーマ名と問い文を直せ、保存後は作った問いへ移動できる
  assert.match(questions, /const group = await store\.create\(title, question\);\s+[\s\S]*?const failed = await store\.addMembers\(group\.id, insightIds\);/);
  assert.match(questions, /<a href=\{questionHref\(saved\.group\.id\)\}>問いを開く<\/a>/);
  assert.match(questions, /件は入れられませんでした。問いのページから追加してください/);
  // 根拠の示唆は順に追加して、読み直しは最後の1回だけにする
  assert.match(groups, /for \(const insightId of insightIds\) \{[\s\S]*?\}\s+await reload\(\);\s+return failed;/);
});
