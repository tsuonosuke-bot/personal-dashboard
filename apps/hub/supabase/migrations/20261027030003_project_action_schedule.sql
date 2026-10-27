-- #308: one durable intent per Action, independent of Wants/Inbox. A lost
-- response always resumes the same Google event and canonical scheduled_action.
create table public.project_schedule_operations (
  request_id uuid primary key,
  action_id bigint not null unique references public.project_actions(id) on delete restrict,
  project_id bigint not null references public.projects(id) on delete restrict,
  action_updated_at timestamptz not null,
  project_updated_at timestamptz not null,
  content text not null check (char_length(btrim(content)) between 1 and 500),
  calendar jsonb not null check (jsonb_typeof(calendar) = 'object'
    and calendar ?& array['allDay','date','startTime','endTime','timeZone']
    and calendar->>'timeZone' = 'Asia/Tokyo'),
  stage text not null default 'planned' check (stage in ('planned','calendar_created','todo_created','linked')),
  event_id text not null unique,
  calendar_url text,
  calendar_etag text,
  todo_id bigint unique references public.scheduled_actions(id) on delete restrict,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_id = 'pc' || replace(request_id::text, '-', '')),
  check (stage = 'planned' or (calendar_url is not null and calendar_etag is not null)),
  check (stage not in ('todo_created','linked') or todo_id is not null)
);
alter table public.project_schedule_operations enable row level security;
revoke all on public.project_schedule_operations from public, anon, authenticated, service_role;
grant select, insert, update on public.project_schedule_operations to service_role;

create or replace function public.begin_project_schedule(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_action_id bigint := (p_request->>'actionId')::bigint;
  v_request_id uuid := (p_request->>'requestId')::uuid;
  v_project_id bigint;
  v_action public.project_actions%rowtype;
  v_project public.projects%rowtype;
  v_op public.project_schedule_operations%rowtype;
  v_content text;
begin
  -- Match existing Action -> Project -> ToDo -> link lock order. Operation
  -- locks always follow the Project lock; finish uses the same ordering.
  v_project_id := public.lock_project_action_group(v_action_id);
  select * into v_action from public.project_actions where id = v_action_id;
  select * into v_project from public.projects where id = v_project_id;
  select * into v_op from public.project_schedule_operations where action_id = v_action_id for update;
  if v_op.request_id is not null then
    v_content := coalesce(nullif(btrim(p_request->>'content'), ''), v_op.content);
    if v_op.request_id <> v_request_id or v_op.content <> v_content
      or v_op.calendar is distinct from p_request->'calendar' then raise exception 'SCHEDULE_REQUEST_CONFLICT'; end if;
    if v_op.stage = 'linked' and exists(select 1 from public.project_action_todos
      where project_action_id = v_action_id and scheduled_action_id = v_op.todo_id) then return to_jsonb(v_op); end if;
  else
    v_content := coalesce(nullif(btrim(p_request->>'content'), ''), v_action.content);
  end if;
  if v_project.status in ('completed','dropped') then raise exception 'PROJECT_NOT_OPEN'; end if;
  if v_action.status not in ('next','queued','waiting')
    or v_action.updated_at is distinct from (p_request->>'actionUpdatedAt')::timestamptz then raise exception 'ACTION_CONFLICT'; end if;
  if v_project.updated_at is distinct from (p_request->>'projectUpdatedAt')::timestamptz then raise exception 'PROJECT_CONFLICT'; end if;
  if exists(select 1 from public.project_action_todos where project_action_id = v_action_id) then raise exception 'TODO_ALREADY_LINKED'; end if;
  if v_op.request_id is null then
    if exists(select 1 from public.project_schedule_operations where request_id = v_request_id) then raise exception 'SCHEDULE_REQUEST_CONFLICT'; end if;
    insert into public.project_schedule_operations(request_id, action_id, project_id, action_updated_at, project_updated_at, content, calendar, event_id)
      values(v_request_id, v_action_id, v_project_id, v_action.updated_at, v_project.updated_at, v_content,
        p_request->'calendar', 'pc' || replace(v_request_id::text, '-', '')) returning * into v_op;
  else
    -- A retry with current snapshots is the user's explicit reconfirmation.
    -- The immutable content, Calendar schedule, event ID and ToDo never change.
    update public.project_schedule_operations set action_updated_at = v_action.updated_at,
      project_updated_at = v_project.updated_at, error_code = null,
      stage = case when stage = 'linked' then 'todo_created' else stage end,
      updated_at = clock_timestamp() where request_id = v_request_id returning * into v_op;
  end if;
  return to_jsonb(v_op);
exception when unique_violation then
  raise exception 'SCHEDULE_REQUEST_CONFLICT';
end;
$$;

create or replace function public.record_project_schedule_calendar(
  p_request_id uuid, p_event_id text, p_calendar_url text, p_calendar_etag text
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_op public.project_schedule_operations%rowtype;
begin
  select * into v_op from public.project_schedule_operations where request_id = p_request_id for update;
  if not found or v_op.event_id is distinct from p_event_id or nullif(p_calendar_etag,'') is null
    or p_calendar_url !~ '^https://([a-zA-Z0-9-]+\.)*google\.com/' or p_calendar_url is null then raise exception 'SCHEDULE_OPERATION_CONFLICT'; end if;
  if v_op.stage in ('todo_created','linked') then return to_jsonb(v_op); end if;
  update public.project_schedule_operations set stage = 'calendar_created', calendar_url = p_calendar_url,
    calendar_etag = p_calendar_etag, error_code = null, updated_at = clock_timestamp()
    where request_id = p_request_id returning * into v_op;
  return to_jsonb(v_op);
end;
$$;

create or replace function public.save_project_schedule_todo(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_op public.project_schedule_operations%rowtype; v_todo public.scheduled_actions%rowtype;
begin
  select * into v_op from public.project_schedule_operations where request_id = p_request_id for update;
  if not found or v_op.stage = 'planned' then raise exception 'SCHEDULE_OPERATION_CONFLICT'; end if;
  if v_op.stage in ('todo_created','linked') then return to_jsonb(v_op); end if;
  -- Calendar sync may already have mirrored this event. Adopt that exact row;
  -- never merge over its execution status, dates, ETag or user notes.
  insert into public.scheduled_actions(google_event_id, calendar_title, calendar_url, calendar_etag,
    calendar_state, current_schedule, last_calendar_sync_at)
    values(v_op.event_id, v_op.content, v_op.calendar_url, v_op.calendar_etag, 'confirmed', v_op.calendar, clock_timestamp())
    on conflict(google_event_id) do nothing;
  select * into v_todo from public.scheduled_actions where google_event_id = v_op.event_id for update;
  if not found then raise exception 'TODO_CONFLICT'; end if;
  update public.project_schedule_operations set stage = 'todo_created', todo_id = v_todo.id,
    error_code = null, updated_at = clock_timestamp() where request_id = p_request_id returning * into v_op;
  return to_jsonb(v_op);
end;
$$;

create or replace function public.finish_project_schedule(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_op public.project_schedule_operations%rowtype;
  v_todo public.scheduled_actions%rowtype;
  v_project_id bigint;
begin
  select * into v_op from public.project_schedule_operations where request_id = p_request_id;
  if not found then raise exception 'SCHEDULE_OPERATION_CONFLICT'; end if;
  v_project_id := public.lock_project_action_group(v_op.action_id);
  select * into v_op from public.project_schedule_operations where request_id = p_request_id for update;
  if v_op.stage = 'linked' then return to_jsonb(v_op); end if;
  if v_op.stage <> 'todo_created' then raise exception 'SCHEDULE_OPERATION_CONFLICT'; end if;
  select * into v_todo from public.scheduled_actions where id = v_op.todo_id for update;
  if not found or v_todo.status <> 'pending' or v_todo.calendar_state <> 'confirmed'
    or v_todo.google_event_id is distinct from v_op.event_id or v_todo.current_schedule is distinct from v_op.calendar
    or v_todo.calendar_etag is distinct from v_op.calendar_etag then raise exception 'TODO_CONFLICT'; end if;
  if not exists(select 1 from public.project_actions where id = v_op.action_id and updated_at = v_op.action_updated_at
    and status in ('next','queued','waiting')) then raise exception 'ACTION_CONFLICT'; end if;
  if not exists(select 1 from public.projects where id = v_project_id and updated_at = v_op.project_updated_at) then raise exception 'PROJECT_CONFLICT'; end if;
  -- Reuse canonical 1:1 linking. Pending preserves Next, queue and waiting;
  -- completion continues to require the existing explicit four-way resolution.
  perform public.link_project_action_todo(jsonb_build_object('actionId',v_op.action_id,
    'actionUpdatedAt',v_op.action_updated_at,'todoId',v_todo.id,'todoUpdatedAt',v_todo.updated_at,'todoStatus','pending'));
  update public.project_schedule_operations set stage = 'linked', error_code = null,
    updated_at = clock_timestamp() where request_id = p_request_id returning * into v_op;
  return to_jsonb(v_op);
end;
$$;

create or replace function public.fail_project_schedule(p_request_id uuid, p_error_code text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.project_schedule_operations set error_code = left(p_error_code,100), updated_at = clock_timestamp()
    where request_id = p_request_id and stage <> 'linked';
end;
$$;

revoke all on function public.begin_project_schedule(jsonb), public.record_project_schedule_calendar(uuid,text,text,text),
  public.save_project_schedule_todo(uuid), public.finish_project_schedule(uuid), public.fail_project_schedule(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_project_schedule(jsonb), public.record_project_schedule_calendar(uuid,text,text,text),
  public.save_project_schedule_todo(uuid), public.finish_project_schedule(uuid), public.fail_project_schedule(uuid,text) to service_role;

-- Partial-success ToDos are retained just like linked/history-bearing ones.
-- Keep the existing ToDo-only lock order: Calendar sync never acquires Project
-- or operation locks and cannot invert Action -> Project -> operation -> ToDo.
create or replace function public.delete_unlinked_scheduled_actions(p_ids bigint[], p_synced_at timestamptz)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_todo public.scheduled_actions%rowtype; v_deleted integer := 0;
begin
  for v_todo in select * from public.scheduled_actions where id = any(p_ids) order by id for update loop
    if exists(select 1 from public.project_action_todos where scheduled_action_id = v_todo.id)
      or exists(select 1 from public.scheduled_action_schedule_history where scheduled_action_id = v_todo.id)
      or exists(select 1 from public.project_schedule_operations where todo_id = v_todo.id)
      or v_todo.status <> 'pending' then
      update public.scheduled_actions set calendar_state = 'cancelled', last_calendar_sync_at = p_synced_at,
        updated_at = clock_timestamp() where id = v_todo.id;
    else
      delete from public.scheduled_actions where id = v_todo.id;
      v_deleted := v_deleted + 1;
    end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.delete_unlinked_scheduled_actions(bigint[],timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.delete_unlinked_scheduled_actions(bigint[],timestamptz) to service_role;

insert into public.dashboard_schema_versions(app_id,migration,updated_at) values('hub','20261027030003_project_action_schedule',now())
  on conflict(app_id) do update set migration = excluded.migration, updated_at = excluded.updated_at;
