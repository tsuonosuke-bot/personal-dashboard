import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Projects page keeps the goal, current action, waiting, and review loop visible", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/projects/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.js", import.meta.url), "utf8"),
    readFile(new URL("../public/projects.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1>Projects<\/h1>/);
  assert.match(html, /id="attentionCount"/);
  assert.match(html, /id="projectOutcomeInput"/);
  assert.match(html, /id="projectNextActionInput"/);
  assert.match(html, /value="continue"/);
  assert.match(html, /value="complete"/);
  assert.match(html, /value="waiting"/);
  assert.match(html, /value="on_hold"/);
  assert.match(script, /fetch\("\/api\/projects"/);
  assert.match(script, /fetch\("\/api\/project-actions"/);
  assert.match(script, /fetch\("\/api\/project-items"/);
  assert.match(script, /"X-Dashboard-Action": "project-action-resolve"/);
  assert.match(script, /originalUpdatedAt: project\.nextAction\.updatedAt/);
  assert.match(script, /\/compass\/\?view=\$\{view\}&id=\$\{item\.sourceId\}/);
  assert.doesNotMatch(script, /SUPABASE_SECRET_KEY|sb_secret_|\.supabase\.co/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /--accent: #7d5a18/);
});

test("Projects migration links sources instead of moving them and enforces one next action", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202609220003_projects_mvp.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.projects/);
  assert.match(migration, /create table if not exists public\.project_items/);
  assert.match(migration, /source_type in \('inbox', 'want'\)/);
  assert.match(migration, /unique \(project_id, source_type, source_id\)/);
  assert.match(migration, /project_items_one_project_per_source_idx/);
  assert.match(migration, /create table if not exists public\.project_actions/);
  assert.match(migration, /project_actions_one_next_idx/);
  assert.match(migration, /where status = 'next'/);
  assert.match(migration, /create_project_with_next_action/);
  assert.match(migration, /create_project_from_source/);
  assert.match(migration, /link_project_source/);
  assert.match(migration, /process_project_item/);
  assert.match(migration, /when v_project\.status = 'active' and not exists/);
  assert.match(migration, /set status = 'done', result = format\('Project/);
  assert.match(migration, /set status = 'completed'/);
  assert.match(migration, /resolve_project_next_action/);
  assert.match(migration, /alter table public\.projects enable row level security/);
});

test("Compass offers Project as a separate commitment without replacing Inbox routes", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /Projectとして進める/);
  assert.match(script, /Object\.entries\(inboxQuickRoutes\)/);
  assert.match(script, /fetch\("\/api\/project-source"/);
  assert.match(script, /"X-Dashboard-Action": "project-source-route"/);
  assert.match(script, /originalProjectUpdatedAt: project\.updatedAt/);
  assert.match(script, /現在のNext Actionは勝手に変更しません/);
  assert.match(css, /\.project-route-action/);
  assert.match(css, /#7d5a18/);
});

test("Projects remains a separate build entry", async () => {
  const [vite, packageJson] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(vite, /projects: resolve\(import\.meta\.dirname, "public\/projects\/index\.html"\)/);
  assert.match(packageJson, /node --check public\/projects\.js/);
});

test("Projects release stays migration-first and has a read-only verification query", async () => {
  const [readme, release, verification, packageJson] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/projects-release.md", import.meta.url), "utf8"),
    readFile(new URL("../supabase/verification/202609220003_projects_mvp_verify.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /アプリのデプロイより先に `supabase\/migrations\/202609220003_projects_mvp\.sql`/);
  assert.match(release, /Cloudflare Pagesより先に上記migrationをSupabaseへ適用/);
  assert.match(release, /本番Supabaseへのmigration適用と、`HEAD:main`へのpushは未実施/);
  assert.match(verification, /projects_with_multiple_next_actions/);
  assert.match(verification, /sources_linked_to_multiple_projects/);
  assert.doesNotMatch(verification, /\b(insert|update|delete|drop|alter|create|truncate)\b/i);
  assert.match(packageJson, /"predeploy:check": "npm test && npm run check && npm run build"/);
});
