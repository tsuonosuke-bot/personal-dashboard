import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dashboardRoutePath, parseDashboardRoute } from "../src/lib/dashboardRoute.ts";
import { buildLearningLog } from "../src/lib/learningLog.ts";
import type { Knowledge, QuizLog } from "../src/types.ts";

const ID_A = "123e4567-e89b-42d3-a456-426614174001";
const ID_B = "123e4567-e89b-42d3-a456-426614174002";

function knowledge(id: string, title: string, category: string): Knowledge {
  return { id, title, category } as Knowledge;
}

function log(id: number, knowledgeId: string, askedOn: string, verdict: QuizLog["verdict"]): QuizLog {
  return {
    id, knowledge_id: knowledgeId, asked_on: askedOn, quality: verdict === "正解" ? 5 : 1,
    verdict, format: "一問一答", note: `note${id}`, created_at: `${askedOn}T03:00:00Z`,
  };
}

const items = [knowledge(ID_A, "英単語A", "英語"), knowledge(ID_B, "IPO", "ビジネス")];
const logs = [
  log(1, ID_A, "2026-08-01", "正解"),
  log(2, ID_B, "2026-09-20", "不正解"),
  log(3, ID_A, "2026-09-22", "部分正解"),
  log(4, "123e4567-e89b-42d3-a456-426614174099", "2026-09-21", "正解"),
];

test("学習ログを新しい順に並べ、期間・カテゴリ・判定で絞り込む", () => {
  const all = buildLearningLog(logs, items, { period: "all", category: "all", verdict: "all" }, "2026-09-22");
  assert.deepEqual(all.map((entry) => entry.id), [3, 4, 2, 1]);
  assert.equal(all[1].title, "（削除されたナレッジ）");

  const week = buildLearningLog(logs, items, { period: "7", category: "all", verdict: "all" }, "2026-09-22");
  assert.deepEqual(week.map((entry) => entry.id), [3, 4, 2]);

  const english = buildLearningLog(logs, items, { period: "all", category: "英語", verdict: "all" }, "2026-09-22");
  assert.deepEqual(english.map((entry) => entry.id), [3, 1]);

  const wrong = buildLearningLog(logs, items, { period: "all", category: "all", verdict: "不正解" }, "2026-09-22");
  assert.deepEqual(wrong.map((entry) => ({ id: entry.id, title: entry.title })), [{ id: 2, title: "IPO" }]);
});

test("学習ログは専用URLを持ち、ダッシュボードから開ける", async () => {
  assert.deepEqual(parseDashboardRoute("https://x.test/?view=log"), { kind: "log" });
  assert.equal(dashboardRoutePath("https://x.test/?knowledge=abc", { kind: "log" }), "/?view=log");

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /initialRoute\.kind === "log"/);
  assert.match(app, /replaceRoute\(open \? \{ kind: "log" \} : \{ kind: "dashboard" \}\)/);
  assert.match(app, /onClick=\{\(\) => setLogOpen\(true\)\}>学習ログ</);
  assert.match(app, /<LearningLogView\s+knowledge=\{registrationKnowledge\}/);
});
