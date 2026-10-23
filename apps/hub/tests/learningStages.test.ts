import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { learningStages, renderLearningStages } from "../public/learning-stages.js";
import { parseDashboardRoute } from "../../knowledge/src/lib/dashboardRoute.ts";

test("four stages use full Hub summaries rather than the selected preview records", () => {
  const stages = learningStages({ activeProjects: 7, pendingInbox: 12, reviewReadyDue: 4, dueKnowledge: 30 });
  assert.deepEqual(stages.map(s => s.id), ["strategy", "input", "structure", "stock"]);
  assert.deepEqual(stages.map(s => s.status), ["進行中 7件", "未整理 12件", "問い・ノート・タグ", "今解ける 4問"]);
  assert.equal(learningStages({ activeProjects: 0 })[0].status, "進行中 0件");
});

test("unavailable and invalid counts never become zero or HTML", () => {
  for (const value of [null, undefined, -1, 1.5, Infinity, NaN, "5", '<img onerror="alert(1)">']) {
    const stages = learningStages({ activeProjects: value, pendingInbox: value, reviewReadyDue: value });
    for (const stage of [stages[0], stages[1], stages[3]]) assert.equal(stage.status, "件数を取得できません");
  }
  const html = renderLearningStages({ activeProjects: 8, pendingInbox: 9, reviewReadyDue: 2 }, { projects: false, inbox: false, knowledge: false });
  assert.equal((html.match(/件数を取得できません/g) || []).length, 3);
  assert.doesNotMatch(html, /8件|9件|2問/);
});

test("learning links use supported deep routes and remain internal", () => {
  const links = learningStages().flatMap(stage => stage.links);
  for (const link of links) assert.equal(new URL(link.url, "https://hub.invalid").origin, "https://hub.invalid");
  assert.deepEqual(parseDashboardRoute(links.find(link => link.label === "整理する")!.url), { kind: "organize", tab: "questions", questionId: null });
  assert.deepEqual(parseDashboardRoute(links.find(link => link.label === "ノート")!.url), { kind: "organize", tab: "notes", questionId: null, theme: null });
  assert.deepEqual(parseDashboardRoute(links.find(link => link.label === "復習する")!.url), { kind: "quiz", mode: "daily" });
  assert.deepEqual(parseDashboardRoute(links.find(link => link.label === "検索する")!.url), { kind: "search" });
  assert.match(renderLearningStages(), /view=organize&amp;tab=notes/);
});

test("the four-stage overview follows today's actions and has matching help", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const help = await readFile(new URL("../public/help/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="todayPanel"') < html.indexOf('id="learningStages"'));
  assert.match(html, /<ol id="learningStages"/);
  assert.match(help, /id="learning"/);
  assert.match(help, /保存したナレッジの総数ではありません/);
});
