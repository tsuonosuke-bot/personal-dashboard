import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRoutePath, parseDashboardRoute } from "../src/lib/dashboardRoute.ts";

const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";

test("Knowledge route parses direct details and quiz routes", () => {
  assert.deepEqual(parseDashboardRoute(`https://knowledge.example/?knowledge=${knowledgeId}`), {
    kind: "knowledge",
    knowledgeId,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=quiz"), { kind: "quiz", mode: "custom" });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=quiz&mode=daily"), {
    kind: "quiz",
    mode: "daily",
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=speaking"), { kind: "speaking" });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=organize"), {
    kind: "organize", tab: "questions", questionId: null,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=organize&tab=tags"), {
    kind: "organize", tab: "tags", questionId: null,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=organize&question=12"), {
    kind: "organize", tab: "questions", questionId: 12,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=organize&tab=bad&question=-1"), {
    kind: "organize", tab: "questions", questionId: null,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/"), { kind: "dashboard" });
});

test("Knowledge route rejects malformed record identifiers", () => {
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?knowledge=not-a-uuid"), {
    kind: "invalid-knowledge",
  });
});

test("Knowledge route paths preserve unrelated parameters and remove stale views", () => {
  assert.equal(
    dashboardRoutePath("https://knowledge.example/?source=hub&view=quiz", { kind: "knowledge", knowledgeId }),
    `/?source=hub&knowledge=${knowledgeId}`,
  );
  assert.equal(
    dashboardRoutePath(`https://knowledge.example/?knowledge=${knowledgeId}`, { kind: "dashboard" }),
    "/",
  );
  assert.equal(
    dashboardRoutePath("https://knowledge.example/", { kind: "quiz", mode: "daily" }),
    "/?view=quiz&mode=daily",
  );
  assert.equal(
    dashboardRoutePath("https://knowledge.example/?mode=daily", { kind: "speaking" }),
    "/?view=speaking",
  );
  assert.equal(
    dashboardRoutePath("https://knowledge.example/?view=organize&tab=tags", { kind: "organize", tab: "questions", questionId: 3 }),
    "/?view=organize&question=3",
  );
  assert.equal(
    dashboardRoutePath("https://knowledge.example/?view=organize&question=3", { kind: "organize", tab: "insights", questionId: null }),
    "/?view=organize&tab=insights",
  );
  assert.equal(
    dashboardRoutePath("https://knowledge.example/?view=organize&tab=tags&question=3", { kind: "dashboard" }),
    "/",
  );
});

test("旧URLの示唆・タグ画面は統合した整理ページの該当タブで開く", () => {
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=insights"), {
    kind: "organize", tab: "questions", questionId: null,
  });
  assert.deepEqual(parseDashboardRoute("https://knowledge.example/?view=tags"), {
    kind: "organize", tab: "tags", questionId: null,
  });
});
