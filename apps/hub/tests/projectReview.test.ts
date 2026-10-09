import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProjects, STALE_DAYS } from "../functions/_shared/projects.ts";
import { renderProjectSection } from "../public/today-panel.js";

// #162: 週次レビュー画面と、14日動きのないProjectの「停滞」。

// 2026-10-20（火）09:00 JST
const NOW = new Date("2026-10-20T00:00:00Z");

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "英語", outcome: "話せる", theme: null, status: "active", target_on: null, review_on: null,
    waiting_for: null, completed_at: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, project_id: 1, project_item_id: null, milestone_id: null, content: "教材を決める", status: "next",
    due_on: null, start_on: null, sort_order: null, waiting_for: null, completed_at: null,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

test("最終更新から14日以上動きのないactive Projectを停滞とし、件数をまとめる", () => {
  assert.equal(STALE_DAYS, 14);
  // 10/6 09:00 JST が最後 → 10/20 で14日
  const stale = normalizeProjects([projectRow({ updated_at: "2026-10-06T00:00:00Z" })], [actionRow({ updated_at: "2026-10-05T00:00:00Z" })], [], [], NOW);
  assert.equal(stale.projects[0].stale, true);
  assert.equal(stale.projects[0].lastActivityAt, "2026-10-06T00:00:00Z");
  assert.equal(stale.summary.stale, 1);
  // 13日なら停滞ではない
  const fresh = normalizeProjects([projectRow({ updated_at: "2026-10-07T00:00:00Z" })], [actionRow({ updated_at: "2026-10-01T00:00:00Z" })], [], [], NOW);
  assert.equal(fresh.projects[0].stale, false);
});

test("最終更新はProject・Action・マイルストンのうち最も新しい日時で判定し、active以外は停滞にしない", () => {
  const recentAction = normalizeProjects(
    [projectRow({ updated_at: "2026-09-01T00:00:00Z" })],
    [actionRow({ updated_at: "2026-10-15T00:00:00Z" })],
    [], [], NOW,
  );
  assert.equal(recentAction.projects[0].stale, false);
  assert.equal(recentAction.projects[0].lastActivityAt, "2026-10-15T00:00:00Z");

  const recentMilestone = normalizeProjects(
    [projectRow({ updated_at: "2026-09-01T00:00:00Z" })],
    [actionRow({ updated_at: "2026-09-01T00:00:00Z" })],
    [],
    [{ id: 5, project_id: 1, title: "基礎", due_on: null, sort_order: 1, status: "open", completed_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }],
    NOW,
  );
  assert.equal(recentMilestone.projects[0].stale, false);

  const waiting = normalizeProjects(
    [projectRow({ status: "waiting", waiting_for: "返信", review_on: "2026-11-01", updated_at: "2026-09-01T00:00:00Z" })],
    [], [], [], NOW,
  );
  assert.equal(waiting.projects[0].stale, false);
});

test("Projects画面に週次レビューのタブを置き、期限超過・要確認・見直し日・停滞・今週の完了をまとめる", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/projects/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.js", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-view="review">週次レビュー <b id="reviewTabCount">/);
  assert.match(html, /id="filtersBar"/);
  for (const title of ["期限超過のタスク", "要確認", "再確認・見直し日", "停滞", "今週完了したタスク"]) {
    assert.match(script, new RegExp(`reviewSection\\("${title}"`));
  }
  // 画面の説明に使う日数は、サーバーの判定と同じ
  assert.match(script, new RegExp(`const STALE_DAYS = ${STALE_DAYS};`));
  assert.match(script, /pending: overdue\.length \+ attention\.length \+ reviewDue\.length \+ stale\.length/);
  assert.match(script, /if \(project\.stale\) return `<span class="badge stale">停滞/);
  assert.match(script, /data-detail="\$\{project\.id\}"/);
  assert.match(css, /\.review-section \{/);
  assert.match(css, /\.badge\.stale/);
});

test("Hubの「着手が必要」で、停滞しているProjectの行に「N日動きなし」を添える", () => {
  const next = { id: 10, content: "教材を決める", status: "next" as const, completedAt: null, updatedAt: "2026-10-01T00:00:00Z" };
  const project = { id: 1, title: "英語", status: "active" as const, targetOn: null, reviewOn: null, nextAction: next, actions: [next] };
  const stale = renderProjectSection({
    status: "ready", data: { projects: [{ ...project, stale: true, lastActivityAt: "2026-10-01T00:00:00Z" }] }, error: null,
  }, { now: NOW });
  assert.match(stale, /19日動きなし/);
  const fresh = renderProjectSection({
    status: "ready", data: { projects: [{ ...project, stale: false, lastActivityAt: "2026-10-19T00:00:00Z" }] }, error: null,
  }, { now: NOW });
  assert.doesNotMatch(fresh, /動きなし/);
});
