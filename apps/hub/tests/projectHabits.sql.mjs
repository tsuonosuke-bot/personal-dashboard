// Optional isolated SQL integration test. Set PROJECT_HABITS_PGLITE_MODULE to
// an installed @electric-sql/pglite module URL if it is outside node_modules.
// This serialized fixture checks SQL behavior and permissions, not multi-session
// lock scheduling. It never connects to an external database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PROJECT_HABITS_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const migration = await readFile(
  new URL("../supabase/migrations/20261027030002_project_habits.sql", import.meta.url),
  "utf8",
);
const checks = [];
const stamp = "2026-10-27T01:02:03.123456+00:00";
const original = {
  projectId: 1,
  projectUpdatedAt: stamp,
  habitId: 7,
  habitUpdatedAt: stamp,
  relationUpdatedAt: null,
};
const rpc = async (name, input) =>
  (await db.query(`select public.${name}($1::jsonb) as result`, [JSON.stringify(input)])).rows[0]
    .result;
const token = async (projectId = 1) =>
  (
    await db.query(
      `select to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') as token from public.project_habits where project_id=$1 and habit_id=7`,
      [projectId],
    )
  ).rows[0].token;
const expectError = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
};
try {
  await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create table public.projects(id bigint primary key, status text not null check(status in ('active','waiting','on_hold','completed','dropped')),updated_at timestamptz not null);
  create table public.habits(id bigint primary key,name text,status text,cadence text,target_per_week integer,updated_at timestamptz not null);
  create table public.habit_logs(id bigint primary key,habit_id bigint references public.habits(id),practiced_on date,kind text,note text);
  create table public.project_actions(id bigint primary key,project_id bigint references public.projects(id),status text,content text);
  grant all on public.projects,public.habits,public.habit_logs,public.project_actions to service_role;
  insert into public.projects values(1,'active','${stamp}'),(2,'active','${stamp}'),(3,'completed','${stamp}');
  insert into public.habits values(7,'運動','active','weekly',3,'${stamp}'),(8,'休止','paused','daily',1,'${stamp}');
  insert into public.habit_logs values(11,7,'2026-10-26','done','運動'),(12,7,'2026-10-27','skip',null);
  insert into public.project_actions values(21,1,'next','受付を確認する');
 `);
  const before = JSON.stringify(
    (
      await db.query(
        `select (select jsonb_agg(p) from public.projects p) as projects,(select jsonb_agg(h) from public.habits h) as habits,(select jsonb_agg(l) from public.habit_logs l) as logs,(select jsonb_agg(a) from public.project_actions a) as actions`,
      )
    ).rows,
  );
  await db.exec(migration);
  await db.exec(migration);
  checks.push("migration applies twice");
  assert.equal(
    (
      await db.query(
        `select relrowsecurity from pg_class where oid='public.project_habits'::regclass`,
      )
    ).rows[0].relrowsecurity,
    true,
  );
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await db.query(`select has_table_privilege($1,'public.project_habits',$2) as allowed`, [
            role,
            privilege,
          ])
        ).rows[0].allowed,
        false,
      );
    for (const name of ["link_project_habit", "unlink_project_habit"])
      assert.equal(
        (
          await db.query(`select has_function_privilege($1,$2,'EXECUTE') as allowed`, [
            role,
            `public.${name}(jsonb)`,
          ])
        ).rows[0].allowed,
        false,
      );
  }
  await db.exec("set role anon");
  await expectError(() => rpc("link_project_habit", original), /permission denied/);
  await db.exec("reset role");
  checks.push("RLS enabled; anon/authenticated table and RPC permissions denied");
  await db.exec("set role service_role");
  assert.equal(Number(await rpc("link_project_habit", original)), 1);
  const first = await token();
  assert.equal(Number(await rpc("link_project_habit", original)), 1);
  assert.equal(await token(), first);
  assert.equal(Number(await rpc("link_project_habit", { ...original, projectId: 2 })), 2);
  assert.equal(
    (await db.query("select count(*)::int as count from public.project_habits where linked"))
      .rows[0].count,
    2,
  );
  checks.push("service_role can link; repeated POST is no-op; same Habit supports two Projects");
  for (const change of [
    { projectUpdatedAt: "2026-10-26T00:00:00Z" },
    { habitUpdatedAt: "2026-10-26T00:00:00Z" },
  ])
    await expectError(
      () => rpc("unlink_project_habit", { ...original, ...change, relationUpdatedAt: first }),
      /PROJECT_CONFLICT|HABIT_CONFLICT/,
    );
  await expectError(
    () => rpc("link_project_habit", { ...original, projectId: 3 }),
    /PROJECT_NOT_OPEN/,
  );
  await expectError(
    () => rpc("link_project_habit", { ...original, extra: true }),
    /PROJECT_HABIT_INVALID/,
  );
  checks.push("Project/Habit optimistic locks, terminal Project and exact payload validation");
  assert.equal(
    Number(await rpc("unlink_project_habit", { ...original, relationUpdatedAt: first })),
    1,
  );
  const unlinked = await token();
  assert.notEqual(unlinked, first);
  assert.equal(
    Number(await rpc("unlink_project_habit", { ...original, relationUpdatedAt: first })),
    1,
  );
  assert.equal(await token(), unlinked);
  await expectError(() => rpc("link_project_habit", original), /PROJECT_HABIT_CONFLICT/);
  assert.equal(
    Number(await rpc("link_project_habit", { ...original, relationUpdatedAt: unlinked })),
    1,
  );
  const relinked = await token();
  assert.notEqual(relinked, unlinked);
  await expectError(
    () => rpc("unlink_project_habit", { ...original, relationUpdatedAt: first }),
    /PROJECT_HABIT_CONFLICT/,
  );
  assert.equal(
    (await db.query("select linked from public.project_habits where project_id=1")).rows[0].linked,
    true,
  );
  checks.push(
    "DELETE replay no-op; old POST cannot resurrect tombstone; stale DELETE cannot remove relinked pair",
  );
  await db.exec("reset role");
  const after = JSON.stringify(
    (
      await db.query(
        `select (select jsonb_agg(p) from public.projects p) as projects,(select jsonb_agg(h) from public.habits h) as habits,(select jsonb_agg(l) from public.habit_logs l) as logs,(select jsonb_agg(a) from public.project_actions a) as actions`,
      )
    ).rows,
  );
  assert.equal(after, before);
  checks.push("all original Project, Habit, logs and Actions unchanged after link/unlink/retry");
  await db.exec(`update public.projects set status='completed' where id=1`);
  assert.equal(
    (await db.query("select linked from public.project_habits where project_id=1")).rows[0].linked,
    true,
  );
  assert.equal(
    Number(await rpc("unlink_project_habit", { ...original, relationUpdatedAt: relinked })),
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int as count from public.habit_logs")).rows[0].count,
    2,
  );
  assert.equal(
    (await db.query("select status from public.habits where id=7")).rows[0].status,
    "active",
  );
  checks.push("Project completion and terminal unlink preserve Habit status and execution history");
  await expectError(
    () => db.exec("delete from public.habits where id=7"),
    /foreign key constraint/,
  );
  await db.exec("delete from public.projects where id=2");
  assert.equal(
    (await db.query("select count(*)::int as count from public.project_habits where project_id=2"))
      .rows[0].count,
    0,
  );
  assert.equal(
    (await db.query("select count(*)::int as count from public.habits")).rows[0].count,
    2,
  );
  checks.push("FK restrict prevents dangling Habit deletion; deleting Project cascades links only");
  const result = {
    success: true,
    engine: "PGlite PostgreSQL",
    scope: "isolated local fixture; no production connections",
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.close();
}
