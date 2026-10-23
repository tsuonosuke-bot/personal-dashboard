import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The browser model is intentionally untyped; exercise its real implementation.
import { createProjectModel } from "../public/projects/model.js";

const makeProject = (id: number, status: string, targetOn: string | null) => ({
  id, status, targetOn, actions: [], items: [], needsAttention: false, stale: false,
  lastActivityAt: "2026-10-22T16:00:00Z",
});

test("目標期限超過はJST今日より前のopen Projectだけを古い順に一度ずつまとめる", () => {
  const projects = ["active", "waiting", "on_hold", "completed", "dropped"].flatMap((status, i) =>
    ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", null].map((targetOn, j) => makeProject(i * 10 + j + 1, status, targetOn)));
  const model = createProjectModel({ state: { data: { projects } }, now: () => new Date("2026-10-22T15:00:00Z") });
  const review = model.reviewData();
  assert.equal(review.today, "2026-10-23");
  assert.deepEqual(review.targetOverdue.map((project: { id: number }) => project.id), [1, 11, 21, 2, 12, 22]);
  assert.equal(review.pending, 6);
  assert.equal(review.overdue.length, 0, "タスク期日なし・直近更新でも目標日だけで検出する");
});

test("複数の見直し理由は既存どおり項目数で合算し、期限変更や完了を再計算する", () => {
  const project = { ...makeProject(1, "active", "2026-10-21"), needsAttention: true, stale: true,
    actions: [{ status: "next", dueOn: "2026-10-20" }] };
  const model = createProjectModel({ state: { data: { projects: [project] } }, now: () => new Date("2026-10-23T00:00:00Z") });
  assert.equal(model.reviewData().pending, 4);
  project.targetOn = "2026-10-23";
  assert.equal(model.reviewData().targetOverdue.length, 0);
  project.targetOn = "2026-10-21";
  project.status = "completed";
  assert.equal(model.reviewData().targetOverdue.length, 0);
});
