// Optional, isolated SQL integration test. Set PROJECT_GOALS_PGLITE_MODULE to
// an installed @electric-sql/pglite module URL when it is outside node_modules.
// Uses fresh synthetic records only; never connects to production. PGlite
// serializes statements, so this does not prove independent-session locking.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PROJECT_GOALS_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const today = "2026-10-27";
const calendar = {
  allDay: false,
  date: "2026-10-28",
  startTime: "09:00",
  endTime: "10:00",
  timeZone: "Asia/Tokyo",
};
let checks = 0;
let sequence = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const reject = async (operation, pattern) => {
  await assert.rejects(operation, pattern);
  checks++;
};
const rpc = async (name, ...args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
const project = async (id) =>
  (await db.query("select to_jsonb(p) as row from public.projects p where id=$1", [id])).rows[0]
    .row;
const goal = async (id) => (await rpc("get_project_goal_status", [id], today))[0];
const review = async (id) => {
  const status = await goal(id);
  return rpc("record_project_review", {
    requestId: requestId(),
    projectId: id,
    projectUpdatedAt: status.projectUpdatedAt,
    fingerprint: status.fingerprint,
  });
};
const readModel = () =>
  rpc("get_project_read_model", "active", "", 0, 50, null, 0, 10, 0, today, false, "recommended");
async function fixture(status = "active") {
  const row = (
    await db.query(
      `insert into public.projects(title,outcome,status,waiting_for,review_on,created_at,updated_at)
    values('goal','finish',$1,case when $1='waiting' then 'reply' end,
      case when $1 in ('waiting','on_hold') then '2026-10-29'::date end,'2026-10-01','2026-10-01') returning id`,
      [status],
    )
  ).rows[0];
  return project(row.id);
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.wants(id bigint primary key);
    create table public.want_routes(id bigint primary key,destination text,status text,target_id text,destination_data jsonb,created_at timestamptz,updated_at timestamptz);
    create table public.dashboard_schema_versions(app_id text primary key,migration text,updated_at timestamptz);`);
  // Apply actual relevant table/constraint definitions. Unrelated routing RPCs
  // and cron configuration are excluded; this is not a full database restore.
  for (const name of [
    "202609220003_projects_mvp.sql",
    "202610090001_project_action_edit.sql",
    "202610100001_project_milestones.sql",
  ]) {
    const sql = await read(name);
    await db.exec(sql.slice(0, sql.indexOf("create or replace function")));
  }
  const triage = await read("202609200001_want_triage.sql");
  await db.exec(
    triage.slice(
      triage.indexOf("create table if not exists public.habits"),
      triage.indexOf("create table if not exists public.focus_items"),
    ),
  );
  for (const name of [
    "202609200003_habits_mvp.sql",
    "202610100002_habit_weekly_target.sql",
    "202610100003_habit_log_skip.sql",
    "202609220004_scheduled_actions.sql",
  ])
    await db.exec(await read(name));
  const sync = await read("202610180001_calendar_todo_sync.sql");
  await db.exec(sync.slice(0, sync.indexOf("create extension")));
  for (const name of [
    "202610180002_calendar_sync_full_unique_index.sql",
    "202610230001_project_action_todos.sql",
    "20261026040133_project_read_model.sql",
    "20261027030001_project_goal_capture_review.sql",
    "20261027030002_project_habits.sql",
    "20261027030003_project_action_schedule.sql",
    "20261027030004_project_review_habit_snapshot.sql",
  ])
    await db.exec(await read(name));

  let p = await fixture();
  await db.query(
    "insert into public.project_actions(project_id,content,status,created_at,updated_at) values($1,'do','next','2026-10-01','2026-10-01')",
    [p.id],
  );
  const before = await readModel();
  const observed = await goal(p.id);
  equal(observed.reviewCurrent, false);
  equal(observed.weekDone, 0);
  const originalReview = {
    requestId: requestId(),
    projectId: p.id,
    projectUpdatedAt: p.updated_at,
    fingerprint: observed.fingerprint,
  };
  const saved = await rpc("record_project_review", originalReview);
  equal(saved.saved, true);
  equal((await goal(p.id)).reviewCurrent, true);
  equal((await project(p.id)).updated_at, p.updated_at);
  const after = await readModel();
  equal(after.summary, before.summary);
  equal(after.projects[0].last_activity_at, before.projects[0].last_activity_at);
  equal(after.projects[0].stale, true);
  await db.query(
    "update public.project_actions set content='changed',updated_at=clock_timestamp() where project_id=$1",
    [p.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);
  equal(await rpc("record_project_review", originalReview), saved);
  equal((await goal(p.id)).reviewCurrent, false);
  await reject(
    rpc("record_project_review", { ...originalReview, requestId: requestId() }),
    /GOAL_REVIEW_CONFLICT/,
  );
  await reject(
    rpc("record_project_review", { ...originalReview, fingerprint: "0".repeat(32) }),
    /GOAL_REQUEST_CONFLICT/,
  );
  await db.query(
    "update public.projects set status='waiting',waiting_for='reply',review_on='2026-10-29',updated_at=clock_timestamp() where id=$1",
    [p.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);
  equal(await rpc("record_project_review", originalReview), saved);
  await db.query(
    "update public.projects set status='active',waiting_for=null,review_on=null,updated_at=clock_timestamp() where id=$1",
    [p.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);

  for (const status of ["active", "waiting", "on_hold"]) {
    p = await fixture(status);
    const capture = {
      requestId: requestId(),
      projectId: p.id,
      projectUpdatedAt: p.updated_at,
      content: "candidate",
    };
    const result = await rpc("capture_project_action", capture);
    equal(result.saved, true);
    equal(await rpc("capture_project_action", capture), result);
    const current = await project(p.id);
    equal(
      [current.status, current.waiting_for, current.review_on],
      [p.status, p.waiting_for, p.review_on],
    );
    equal(
      (
        await db.query("select content,status from public.project_actions where project_id=$1", [
          p.id,
        ])
      ).rows,
      [{ content: "candidate", status: "queued" }],
    );
    await reject(
      rpc("capture_project_action", { ...capture, content: "different" }),
      /GOAL_REQUEST_CONFLICT/,
    );
    await reject(
      rpc("capture_project_action", { ...capture, requestId: requestId() }),
      /PROJECT_CONFLICT/,
    );
  }
  p = await fixture();
  const next = (
    await db.query(
      "insert into public.project_actions(project_id,content,status) values($1,'current next','next') returning id",
      [p.id],
    )
  ).rows[0].id;
  await rpc("capture_project_action", {
    requestId: requestId(),
    projectId: p.id,
    projectUpdatedAt: p.updated_at,
    content: "later",
  });
  equal(
    (
      await db.query(
        "select id from public.project_actions where project_id=$1 and status='next'",
        [p.id],
      )
    ).rows,
    [{ id: next }],
  );
  equal((await readModel()).projects.find((row) => row.id === p.id).needs_attention, false);

  p = await fixture();
  await db.query(
    "insert into public.project_milestones(project_id,title,sort_order,status,completed_at) values($1,'done',1,'done',now()),($1,'next milestone',2,'open',null),($1,'later',3,'open',null)",
    [p.id],
  );
  equal((await goal(p.id)).nextMilestone.title, "next milestone");
  await db.query(
    "update public.project_milestones set sort_order=0 where project_id=$1 and title='later'",
    [p.id],
  );
  equal((await goal(p.id)).nextMilestone.title, "later");
  await db.query("delete from public.project_milestones where project_id=$1 and title='later'", [
    p.id,
  ]);
  equal((await goal(p.id)).nextMilestone.title, "next milestone");
  await db.query(
    "update public.project_milestones set status='done',completed_at=clock_timestamp() where project_id=$1 and title='next milestone'",
    [p.id],
  );
  equal((await goal(p.id)).nextMilestone, null);
  await db.query(
    "insert into public.project_actions(project_id,content,status,completed_at) values($1,'last week','done','2026-10-25T14:59:59Z'),($1,'this week','done','2026-10-25T15:00:00Z'),($1,'undone','cancelled',null)",
    [p.id],
  );
  equal((await goal(p.id)).weekDone, 1);
  equal((await readModel()).actions.filter((row) => row.project_id === p.id).length, 0);
  await db.query(
    "update public.project_actions set status='queued',completed_at=null where project_id=$1 and content='this week'",
    [p.id],
  );
  equal((await goal(p.id)).weekDone, 0);
  equal((await readModel()).projects.find((row) => row.id === p.id).needs_attention, false);

  // The final helper installed after the relation migration must fingerprint
  // canonical support state without moving Project/activity timestamps.
  p = await fixture();
  const habit = (
    await db.query(
      "insert into public.habits(name,cadence,started_on) values('exercise','weekly','2026-10-01') returning to_jsonb(habits) as row",
    )
  ).rows[0].row;
  const relationInput = {
    projectId: p.id,
    projectUpdatedAt: p.updated_at,
    habitId: habit.id,
    habitUpdatedAt: habit.updated_at,
    relationUpdatedAt: null,
  };
  await review(p.id);
  await rpc("link_project_habit", relationInput);
  equal((await goal(p.id)).reviewCurrent, false);
  equal((await project(p.id)).updated_at, p.updated_at);
  await review(p.id);
  const relation = (
    await db.query(
      "select updated_at from public.project_habits where project_id=$1 and habit_id=$2",
      [p.id, habit.id],
    )
  ).rows[0];
  await rpc("unlink_project_habit", { ...relationInput, relationUpdatedAt: relation.updated_at });
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  const unlinked = (
    await db.query(
      "select updated_at from public.project_habits where project_id=$1 and habit_id=$2",
      [p.id, habit.id],
    )
  ).rows[0];
  await rpc("link_project_habit", { ...relationInput, relationUpdatedAt: unlinked.updated_at });
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  await db.query(
    "update public.habits set cadence='daily',updated_at=clock_timestamp() where id=$1",
    [habit.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  await db.query(
    "insert into public.habit_logs(habit_id,practiced_on,kind,note) values($1,'2026-10-27','done','exercise')",
    [habit.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  await db.query("update public.habit_logs set kind='skip',note='rest' where habit_id=$1", [
    habit.id,
  ]);
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  await db.query("delete from public.habit_logs where habit_id=$1", [habit.id]);
  equal((await goal(p.id)).reviewCurrent, false);
  equal((await project(p.id)).updated_at, p.updated_at);

  // Confirmed cache freshness is not an edit. Meaningful projected dates are.
  p = await fixture();
  const action = (
    await db.query(
      "insert into public.project_actions(project_id,content,status) values($1,'scheduled','next') returning to_jsonb(project_actions) as row",
      [p.id],
    )
  ).rows[0].row;
  const todo = (
    await db.query(
      "insert into public.scheduled_actions(google_event_id,current_schedule) values('review-cache-event',$1) returning to_jsonb(scheduled_actions) as row",
      [calendar],
    )
  ).rows[0].row;
  await rpc("link_project_action_todo", {
    actionId: action.id,
    actionUpdatedAt: action.updated_at,
    todoId: todo.id,
    todoUpdatedAt: todo.updated_at,
    todoStatus: "pending",
  });
  const linkedTodo = (
    await db.query("select to_jsonb(t) as row from public.scheduled_actions t where id=$1", [
      todo.id,
    ])
  ).rows[0].row;
  const cache = {
    id: todo.id,
    updated_at: linkedTodo.updated_at,
    effective_date: calendar.date,
    schedule: calendar,
    fetched_at: "2026-10-27T01:00:00Z",
  };
  await rpc("record_project_todo_read_cache", [cache]);
  await review(p.id);
  const fingerprint = (await goal(p.id)).fingerprint;
  await rpc("record_project_todo_read_cache", [{ ...cache, fetched_at: "2026-10-27T02:00:00Z" }]);
  equal((await goal(p.id)).fingerprint, fingerprint);
  equal((await goal(p.id)).reviewCurrent, true);
  await rpc("record_project_todo_read_cache", [
    {
      ...cache,
      effective_date: "2026-10-29",
      schedule: { ...calendar, date: "2026-10-29" },
      fetched_at: "2026-10-27T03:00:00Z",
    },
  ]);
  equal((await goal(p.id)).reviewCurrent, false);
  await review(p.id);
  await db.query(
    "update public.scheduled_actions set current_schedule=jsonb_set(current_schedule,'{date}','\"2026-10-30\"'),updated_at=clock_timestamp() where id=$1",
    [todo.id],
  );
  equal((await goal(p.id)).reviewCurrent, false);

  for (const role of ["anon", "authenticated"]) {
    for (const name of [
      "public.capture_project_action(jsonb)",
      "public.record_project_review(jsonb)",
      "public.get_project_goal_status(bigint[],date)",
      "public.project_habit_review_fingerprint(bigint)",
    ]) {
      equal(
        (await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, name]))
          .rows[0].allowed,
        false,
      );
    }
    for (const table of ["project_goal_requests", "project_reviews"])
      equal(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT') as allowed", [
            role,
            `public.${table}`,
          ])
        ).rows[0].allowed,
        false,
      );
  }
  equal(
    (
      await db.query(
        "select has_function_privilege('service_role','public.get_project_goal_status(bigint[],date)','EXECUTE') as allowed",
      )
    ).rows[0].allowed,
    true,
  );
  equal(
    (
      await db.query(
        "select bool_and(relrowsecurity) as enabled from pg_class where oid in ('public.project_goal_requests'::regclass,'public.project_reviews'::regclass)",
      )
    ).rows[0].enabled,
    true,
  );
  console.log(
    `Project goals SQL: ${checks} checks passed in isolated PGlite PostgreSQL fixture; no production connection. Independent-session concurrency remains a separate validation.`,
  );
} finally {
  await db.close();
}
