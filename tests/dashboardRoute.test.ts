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
});
