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
  assert.match(script, /"X-Dashboard-Action": "project-action-resolve"/);
  assert.match(script, /originalUpdatedAt: project\.nextAction\.updatedAt/);
  assert.match(script, /\/compass\/\?view=\$\{view\}&id=\$\{item\.sourceId\}/);
  assert.doesNotMatch(script, /SUPABASE_SECRET_KEY|sb_secret_|\.supabase\.co/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /--accent: #365b7b/);
});

test("Projects migration links sources instead of moving them and enforces one next action", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202609220002_projects_mvp.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.projects/);
  assert.match(migration, /create table if not exists public\.project_items/);
  assert.match(migration, /source_type in \('inbox', 'want'\)/);
  assert.match(migration, /unique \(project_id, source_type, source_id\)/);
  assert.match(migration, /create table if not exists public\.project_actions/);
  assert.match(migration, /project_actions_one_next_idx/);
  assert.match(migration, /where status = 'next'/);
  assert.match(migration, /create_project_with_next_action/);
  assert.match(migration, /resolve_project_next_action/);
  assert.match(migration, /alter table public\.projects enable row level security/);
});

test("Projects is a separate build entry without changing Compass page code", async () => {
  const [vite, packageJson] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(vite, /projects: resolve\(import\.meta\.dirname, "public\/projects\/index\.html"\)/);
  assert.match(packageJson, /node --check public\/projects\.js/);
});
