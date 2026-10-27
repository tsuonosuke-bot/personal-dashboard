/** Optional isolated PostgreSQL fixture. Set PROJECT_SCHEDULE_PGLITE_MODULE to an
 * installed @electric-sql/pglite module URL, then run node tests/projectSchedule.sql.mjs.
 * Uses no production connection. PGlite serializes calls; this does not prove
 * independent PostgreSQL-session lock scheduling. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.PROJECT_SCHEDULE_PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const schedule = {
  allDay: false,
  date: "2026-11-04",
  startTime: "09:00",
  endTime: "10:00",
  timeZone: "Asia/Tokyo",
};
let sequence = 0;
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const call = async (name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
async function fixture() {
  sequence++;
  const project = (
    await db.query(
      "insert into public.projects(title,outcome) values('test','done') returning to_jsonb(projects) as row",
    )
  ).rows[0].row;
  const action = (
    await db.query(
      "insert into public.project_actions(project_id,content,status) values($1,'apply','next') returning to_jsonb(project_actions) as row",
      [project.id],
    )
  ).rows[0].row;
  return {
    actionId: action.id,
    actionUpdatedAt: action.updated_at,
    projectUpdatedAt: project.updated_at,
    requestId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    content: "apply",
    calendar: schedule,
  };
}
const begin = (input) => call("begin_project_schedule", [input]);
const record = (op) =>
  call("record_project_schedule_calendar", [
    op.request_id,
    op.event_id,
    "https://calendar.google.com/calendar/event?eid=test",
    '"e1"',
  ]);
const save = (op) => call("save_project_schedule_todo", [op.request_id]);
const finish = (op) => call("finish_project_schedule", [op.request_id]);
const get = async (requestId) =>
  (
    await db.query(
      "select to_jsonb(o) as row from public.project_schedule_operations o where request_id=$1",
      [requestId],
    )
  ).rows[0].row;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.want_routes(id bigint primary key,destination text,status text,target_id text,destination_data jsonb,created_at timestamptz,updated_at timestamptz);
    create table public.dashboard_schema_versions(app_id text primary key,migration text,updated_at timestamptz);
  `);
  // Actual table/constraint portions, avoiding unrelated source-routing RPCs.
  for (const file of [
    "202609220003_projects_mvp.sql",
    "202610090001_project_action_edit.sql",
    "202610100001_project_milestones.sql",
  ]) {
    const sql = await read(file);
    await db.exec(sql.slice(0, sql.indexOf("create or replace function")));
  }
  await db.exec(await read("202609220004_scheduled_actions.sql"));
  const sync = await read("202610180001_calendar_todo_sync.sql");
  await db.exec(sync.slice(0, sync.indexOf("create extension")));
  await db.exec(await read("202610180002_calendar_sync_full_unique_index.sql"));
  await db.exec(await read("202610230001_project_action_todos.sql"));
  await db.exec(await read("20261027030003_project_action_schedule.sql"));

  let input = await fixture();
  let op = await begin(input);
  check(op.stage, "planned");
  check(op.action_updated_at, input.actionUpdatedAt);
  await db.exec("begin");
  await record(op);
  await db.exec("rollback");
  check((await get(input.requestId)).stage, "planned");
  op = await record(op);
  check(op.stage, "calendar_created");
  op = await save(op);
  check(op.stage, "todo_created");
  op = await finish(op);
  check(op.stage, "linked");
  check((await begin(input)).todo_id, op.todo_id);
  check((await finish(op)).todo_id, op.todo_id);
  const action = (
    await db.query("select status,content from public.project_actions where id=$1", [
      input.actionId,
    ])
  ).rows[0];
  check(action, { status: "next", content: "apply" });
  check(
    (
      await db.query(
        "select count(*)::integer as n from public.project_action_todos where project_action_id=$1",
        [input.actionId],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    begin({ ...input, requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    /SCHEDULE_REQUEST_CONFLICT/,
  );
  checks++;
  await assert.rejects(
    begin({ ...input, calendar: { ...schedule, date: "2026-11-05" } }),
    /SCHEDULE_REQUEST_CONFLICT/,
  );
  checks++;

  input = await fixture();
  op = await begin(input);
  // Duplicate in-flight intent is serialized to the same row and event ID.
  const repeated = await Promise.all([begin(input), begin(input)]);
  check(
    repeated.map((row) => row.event_id),
    [op.event_id, op.event_id],
  );
  // Calendar-sync mirror arrived before save: reuse its one canonical ToDo.
  const mirrored = (
    await db.query(
      "insert into public.scheduled_actions(google_event_id,current_schedule,calendar_title,calendar_url,calendar_etag) values($1,$2,'apply','https://calendar.google.com/', $3) returning id",
      [op.event_id, schedule, '"e1"'],
    )
  ).rows[0].id;
  op = await save(await record(op));
  check(op.todo_id, mirrored);
  await db.query(
    "update public.scheduled_actions set status='completed',completed_at=clock_timestamp() where id=$1",
    [mirrored],
  );
  await assert.rejects(finish(op), /TODO_CONFLICT/);
  checks++;
  check((await get(input.requestId)).stage, "todo_created");
  check(
    (await db.query("select status from public.scheduled_actions where id=$1", [mirrored])).rows[0]
      .status,
    "completed",
  );

  input = await fixture();
  op = await save(await record(await begin(input)));
  await db.query(
    "update public.project_actions set content='edited',updated_at=clock_timestamp() where id=$1",
    [input.actionId],
  );
  await assert.rejects(finish(op), /ACTION_CONFLICT/);
  checks++;
  const current = (
    await db.query("select to_jsonb(a) as row from public.project_actions a where id=$1", [
      input.actionId,
    ])
  ).rows[0].row;
  await assert.rejects(begin(input), /ACTION_CONFLICT/);
  checks++;
  op = await begin({ ...input, actionUpdatedAt: current.updated_at });
  check((await finish(op)).todo_id, op.todo_id);
  check(
    (await db.query("select content from public.project_actions where id=$1", [input.actionId]))
      .rows[0].content,
    "edited",
  );

  for (const edit of [
    "calendar_etag='changed'",
    "current_schedule=jsonb_set(current_schedule,'{date}','\"2026-11-05\"')",
    "calendar_state='cancelled'",
  ]) {
    input = await fixture();
    op = await save(await record(await begin(input)));
    await db.query(`update public.scheduled_actions set ${edit} where id=$1`, [op.todo_id]);
    await assert.rejects(finish(op), /TODO_CONFLICT/);
    checks++;
    check((await get(input.requestId)).todo_id, op.todo_id);
  }
  input = await fixture();
  op = await save(await record(await begin(input)));
  await db.query(
    "update public.projects set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1",
    [op.project_id],
  );
  await assert.rejects(finish(op), /PROJECT_CONFLICT/);
  checks++;
  await assert.rejects(begin(input), /PROJECT_NOT_OPEN/);
  checks++;
  check((await get(input.requestId)).stage, "todo_created");

  input = await fixture();
  op = await save(await record(await begin(input)));
  const other = (
    await db.query(
      "insert into public.scheduled_actions(google_event_id,current_schedule) values('other-event',$1) returning to_jsonb(scheduled_actions) as row",
      [schedule],
    )
  ).rows[0].row;
  await call("link_project_action_todo", [
    {
      actionId: input.actionId,
      actionUpdatedAt: input.actionUpdatedAt,
      todoId: other.id,
      todoUpdatedAt: other.updated_at,
      todoStatus: "pending",
    },
  ]);
  await assert.rejects(finish(op), /ACTION_CONFLICT/);
  checks++;
  check((await get(input.requestId)).todo_id, op.todo_id);
  check(
    (
      await db.query(
        "select scheduled_action_id from public.project_action_todos where project_action_id=$1",
        [input.actionId],
      )
    ).rows[0].scheduled_action_id,
    other.id,
  );

  input = await fixture();
  op = await save(await record(await begin(input)));
  const disposable = (
    await db.query(
      "insert into public.scheduled_actions(google_event_id,current_schedule) values('disposable-event',$1) returning id",
      [schedule],
    )
  ).rows[0].id;
  check(
    await call("delete_unlinked_scheduled_actions", [
      [op.todo_id, disposable],
      new Date().toISOString(),
    ]),
    1,
  );
  check(
    (
      await db.query("select calendar_state from public.scheduled_actions where id=$1", [
        op.todo_id,
      ])
    ).rows[0].calendar_state,
    "cancelled",
  );
  check((await get(input.requestId)).todo_id, op.todo_id);
  await assert.rejects(finish(op), /TODO_CONFLICT/);
  checks++;

  const rights = (
    await db.query(`select
    has_table_privilege('anon','public.project_schedule_operations','SELECT') as anon_read,
    has_table_privilege('authenticated','public.project_schedule_operations','UPDATE') as authenticated_write,
    has_function_privilege('anon','public.begin_project_schedule(jsonb)','EXECUTE') as anon_rpc,
    has_function_privilege('service_role','public.finish_project_schedule(uuid)','EXECUTE') as service_rpc,
    (select relrowsecurity from pg_class where oid='public.project_schedule_operations'::regclass) as rls`)
  ).rows[0];
  check(rights, {
    anon_read: false,
    authenticated_write: false,
    anon_rpc: false,
    service_rpc: true,
    rls: true,
  });
  console.log(
    `Project schedule SQL: ${checks} checks passed in isolated PGlite PostgreSQL fixture; no production connection. Independent-session concurrency remains a separate validation.`,
  );
} finally {
  await db.close();
}
