import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quiz view can be opened from and closed back to the URL", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /initialRoute\.kind === "quiz"/);
  assert.match(source, /initialRoute\.kind === "quiz" \? initialRoute\.mode : "custom"/);
  assert.match(source, /replaceRoute\(open \? \{ kind: "quiz", mode \} : \{ kind: "dashboard" \}\)/);
  assert.match(source, /onExit=\{exitReview\}/);
  // ノートから始めた復習はノートへ戻り、それ以外はダッシュボードへ戻る
  assert.match(source, /selectNote\(reviewScope\.returnTo\);[\s\S]*?setQuizOpen\(false\);/);
  assert.match(source, /onRecorded=\{reloadAfterReview\}/);
  assert.match(source, /onStart=\{\(\) => setQuizOpen\(true, "daily"\)\}/);
  assert.doesNotMatch(source, /onCustomStart/);
});

test("knowledge details follow direct URLs, history, and safe fallbacks", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.history\.pushState\(/);
  assert.match(source, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(source, /knowledge\.find\(\(item\) => item\.id === route\.knowledgeId\)/);
  assert.match(source, /if \(archived\) \{\s*setArchiveOpen\(false\);\s*setSelected\(archived\)/);
  assert.match(source, /onEdit=\{selected\.archived \? undefined : \(\) => openEdit\(selected\)\}/);
  assert.match(source, /対象のナレッジが見つかりません。一覧を表示します/);
  assert.match(source, /onOpen=\{openKnowledge\}/);
  assert.match(source, /onClose=\{closeKnowledge\}/);
});

test("speaking practice has an independent URL and dashboard entry", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /initialRoute\.kind === "speaking"/);
  assert.match(source, /replaceRoute\(open \? \{ kind: "speaking" \} : \{ kind: "dashboard" \}\)/);
  assert.match(source, /<SpeakingPracticePanel/);
  assert.match(source, /<SpeakingPracticeView/);
});
