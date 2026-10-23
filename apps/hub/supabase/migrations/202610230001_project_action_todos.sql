-- Explicit one-to-one execution links (#232). Dates remain owned by Calendar;
-- the independent Project dates stay on project_actions for unlinking.
create table public.project_action_todos (
  project_action_id bigint primary key references public.project_actions(id) on delete cascade,
  scheduled_action_id bigint not null unique references public.scheduled_actions(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.project_action_todos enable row level security;
revoke all on public.project_action_todos from public, anon, authenticated;
grant select, insert, update, delete on public.project_action_todos to service_role;

-- Every path that may change an existing Action locks ALL (including terminal)
-- Actions by id, then Project, then ToDo, then the link. Internal helpers are
-- not callable through PostgREST by browser roles.
create or replace function public.lock_project_action_group(p_action_id bigint)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_project_id bigint;
begin
  select project_id into v_project_id from public.project_actions where id = p_action_id;
  if not found then raise exception 'ACTION_CONFLICT'; end if;
  perform 1 from public.project_actions where project_id = v_project_id order by id for update;
  perform 1 from public.projects where id = v_project_id for update;
  if not found then raise exception 'PROJECT_CONFLICT'; end if;
  return v_project_id;
end;
$$;

-- Locks are owned by the entry RPC. The same four outcomes apply to completing
-- AND skipping a Next Action, no matter which screen starts the operation.
create or replace function public.finish_project_next_action(
  p_action_id bigint, p_terminal text, p_completed_at timestamptz, p_resolution jsonb
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_action public.project_actions%rowtype;
  v_project public.projects%rowtype;
  v_next_id bigint;
  v_next_content text := nullif(btrim(p_resolution->>'nextActionContent'), '');
  v_resolution text := p_resolution->>'resolution';
begin
  select * into v_action from public.project_actions where id = p_action_id and status = 'next';
  if not found then raise exception 'ACTION_CONFLICT'; end if;
  select * into v_project from public.projects where id = v_action.project_id;
  if v_project.status <> 'active' then raise exception 'PROJECT_NOT_ACTIVE'; end if;
  if p_terminal not in ('done', 'cancelled') or p_terminal is null then raise exception 'ACTION_OPERATION_INVALID'; end if;
  if p_resolution is null or jsonb_typeof(p_resolution) <> 'object'
    or (p_resolution - array['resolution','nextActionId','nextActionContent','waitingFor','reviewOn']) <> '{}'::jsonb then
    raise exception 'RESOLUTION_INVALID';
  end if;
  update public.project_actions
    set status = p_terminal, completed_at = case when p_terminal = 'done' then p_completed_at else null end,
        waiting_for = null, sort_order = null, updated_at = clock_timestamp()
    where id = p_action_id;
  if v_resolution = 'continue' then
    v_next_id := (p_resolution->>'nextActionId')::bigint;
    if (v_next_id is null) = (v_next_content is null) then raise exception 'NEXT_ACTION_REQUIRED'; end if;
    if v_next_id is not null then
      update public.project_actions set status = 'next', sort_order = null, updated_at = clock_timestamp()
        where id = v_next_id and project_id = v_project.id and status = 'queued';
      if not found then raise exception 'QUEUED_ACTION_NOT_FOUND'; end if;
    else
      insert into public.project_actions(project_id, content, status)
        values(v_project.id, v_next_content, 'next');
    end if;
    update public.projects set status = 'active', completed_at = null, waiting_for = null, review_on = null,
      updated_at = clock_timestamp() where id = v_project.id;
  elsif v_resolution = 'complete' then
    update public.projects set status = 'completed', completed_at = p_completed_at,
      waiting_for = null, review_on = null, updated_at = clock_timestamp() where id = v_project.id;
  elsif v_resolution = 'waiting' then
    if nullif(btrim(p_resolution->>'waitingFor'), '') is null or nullif(p_resolution->>'reviewOn', '') is null then
      raise exception 'WAITING_DETAILS_REQUIRED';
    end if;
    update public.projects set status = 'waiting', waiting_for = btrim(p_resolution->>'waitingFor'),
      review_on = (p_resolution->>'reviewOn')::date, updated_at = clock_timestamp() where id = v_project.id;
  elsif v_resolution = 'on_hold' then
    if nullif(p_resolution->>'reviewOn', '') is null then raise exception 'REVIEW_DATE_REQUIRED'; end if;
    update public.projects set status = 'on_hold', waiting_for = null,
      review_on = (p_resolution->>'reviewOn')::date, updated_at = clock_timestamp() where id = v_project.id;
  else raise exception 'RESOLUTION_INVALID';
  end if;
  return v_project.id;
end;
$$;

create or replace function public.link_project_action_todo(p_request jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_project_id bigint;
  v_action public.project_actions%rowtype;
  v_todo public.scheduled_actions%rowtype;
  v_link public.project_action_todos%rowtype;
  v_action_id bigint := (p_request->>'actionId')::bigint;
  v_todo_id bigint := (p_request->>'todoId')::bigint;
  v_terminal text;
begin
  v_project_id := public.lock_project_action_group(v_action_id);
  select * into v_action from public.project_actions where id = v_action_id;
  select * into v_todo from public.scheduled_actions where id = v_todo_id for update;
  if not found then raise exception 'TODO_CONFLICT'; end if;
  select * into v_link from public.project_action_todos
    where project_action_id = v_action_id or scheduled_action_id = v_todo_id
    order by project_action_id limit 1 for update;
  if found then
    -- A lost success response may be replayed with the original snapshots.
    if v_link.project_action_id = v_action_id and v_link.scheduled_action_id = v_todo_id then return v_project_id; end if;
    raise exception 'TODO_ALREADY_LINKED';
  end if;
  if (select status from public.projects where id = v_project_id) in ('completed','dropped') then raise exception 'PROJECT_NOT_OPEN'; end if;
  if v_action.updated_at is distinct from (p_request->>'actionUpdatedAt')::timestamptz
    or v_todo.updated_at is distinct from (p_request->>'todoUpdatedAt')::timestamptz
    or v_todo.status is distinct from p_request->>'todoStatus' then raise exception 'TODO_LINK_CONFLICT'; end if;
  if v_todo.status = 'pending' then
    if v_action.status in ('done','cancelled') then
      update public.project_actions set status = 'queued', completed_at = null, waiting_for = null,
        sort_order = coalesce((select max(sort_order) from public.project_actions where project_id = v_project_id), 0) + 1
        where id = v_action.id;
    end if;
  else
    v_terminal := case when v_todo.status = 'completed' then 'done' else 'cancelled' end;
    if v_action.status = 'next' then
      perform public.finish_project_next_action(v_action.id, v_terminal, coalesce(v_todo.completed_at, clock_timestamp()), p_request->'resolution');
    else
      update public.project_actions set status = v_terminal, completed_at = v_todo.completed_at,
        waiting_for = null, sort_order = null where id = v_action.id;
    end if;
  end if;
  insert into public.project_action_todos(project_action_id, scheduled_action_id) values(v_action_id, v_todo_id);
  -- Invalidate stale, previously-unlinked clients on BOTH sides.
  update public.project_actions set updated_at = clock_timestamp() where id = v_action_id;
  update public.scheduled_actions set updated_at = clock_timestamp() where id = v_todo_id;
  update public.projects set updated_at = clock_timestamp() where id = v_project_id;
  return v_project_id;
end;
$$;

create or replace function public.unlink_project_action_todo(p_request jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_project_id bigint;
  v_action public.project_actions%rowtype;
  v_todo public.scheduled_actions%rowtype;
  v_action_id bigint := (p_request->>'actionId')::bigint;
  v_todo_id bigint := (p_request->>'todoId')::bigint;
begin
  v_project_id := public.lock_project_action_group(v_action_id);
  select * into v_action from public.project_actions where id = v_action_id;
  select * into v_todo from public.scheduled_actions where id = v_todo_id for update;
  if not found then raise exception 'TODO_CONFLICT'; end if;
  perform 1 from public.project_action_todos where project_action_id = v_action_id and scheduled_action_id = v_todo_id for update;
  if not found or v_action.updated_at is distinct from (p_request->>'actionUpdatedAt')::timestamptz
    or v_todo.updated_at is distinct from (p_request->>'todoUpdatedAt')::timestamptz
    or v_todo.status is distinct from p_request->>'todoStatus' then raise exception 'TODO_LINK_CONFLICT'; end if;
  delete from public.project_action_todos where project_action_id = v_action_id;
  update public.project_actions set updated_at = clock_timestamp() where id = v_action_id;
  update public.scheduled_actions set updated_at = clock_timestamp() where id = v_todo_id;
  update public.projects set updated_at = clock_timestamp() where id = v_project_id;
  return v_project_id;
end;
$$;

-- ALL execution updates, including unlinked ones, use this entry point. A
-- link created after the HTTP read must never permit a ToDo-only REST PATCH.
create or replace function public.update_linked_todo(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_action_id bigint;
  v_project_id bigint;
  v_action public.project_actions%rowtype;
  v_todo public.scheduled_actions%rowtype;
  v_todo_id bigint := (p_request->>'todoId')::bigint;
  v_expected_action bigint := (p_request->>'actionId')::bigint;
  v_command text := p_request->>'command';
  v_status text;
  v_at timestamptz := clock_timestamp();
begin
  select project_action_id into v_action_id from public.project_action_todos where scheduled_action_id = v_todo_id;
  if v_action_id is distinct from v_expected_action then raise exception 'TODO_LINK_CONFLICT'; end if;
  if v_action_id is not null then v_project_id := public.lock_project_action_group(v_action_id); end if;
  select * into v_todo from public.scheduled_actions where id = v_todo_id for update;
  if not found or v_todo.updated_at is distinct from (p_request->>'todoUpdatedAt')::timestamptz
    or v_todo.status is distinct from p_request->>'todoStatus' then raise exception 'TODO_CONFLICT'; end if;
  -- Recheck after locks; a link/unlink may have won while this RPC waited.
  if (select project_action_id from public.project_action_todos where scheduled_action_id = v_todo_id)
    is distinct from v_action_id then raise exception 'TODO_LINK_CONFLICT'; end if;
  if v_action_id is not null then
    perform 1 from public.project_action_todos where scheduled_action_id = v_todo_id for update;
    select * into v_action from public.project_actions where id = v_action_id;
    if v_action.updated_at is distinct from (p_request->>'actionUpdatedAt')::timestamptz then raise exception 'ACTION_CONFLICT'; end if;
    if (select status from public.projects where id = v_project_id) in ('completed','dropped') then raise exception 'TODO_PROJECT_CLOSED'; end if;
  end if;
  if v_command in ('complete','skip') then
    if v_todo.status <> 'pending' then raise exception 'TODO_CONFLICT'; end if;
    v_status := case when v_command = 'complete' then 'completed' else 'skipped' end;
    if v_action_id is not null then
      if v_action.status = 'next' then
        perform public.finish_project_next_action(v_action_id, case when v_command = 'complete' then 'done' else 'cancelled' end, v_at, p_request->'resolution');
      else
        update public.project_actions set status = case when v_command = 'complete' then 'done' else 'cancelled' end,
          completed_at = case when v_command = 'complete' then v_at else null end,
          waiting_for = null, sort_order = null, updated_at = clock_timestamp() where id = v_action_id;
      end if;
    end if;
  elsif v_command = 'reopen' then
    if v_todo.status = 'pending' then raise exception 'TODO_CONFLICT'; end if;
    v_status := 'pending';
    if v_action_id is not null then
      update public.project_actions set status = 'queued', completed_at = null, waiting_for = null,
        sort_order = coalesce((select max(sort_order) from public.project_actions where project_id = v_project_id),0)+1,
        updated_at = clock_timestamp() where id = v_action_id;
    end if;
  else raise exception 'TODO_OPERATION_INVALID';
  end if;
  update public.scheduled_actions set status = v_status,
    completed_at = case when v_status = 'completed' then v_at else null end,
    note = p_request->>'note', updated_at = clock_timestamp() where id = v_todo_id returning * into v_todo;
  if v_project_id is not null then update public.projects set updated_at = clock_timestamp() where id = v_project_id; end if;
  return jsonb_build_object('id', v_todo.id, 'status', v_todo.status, 'completedAt', v_todo.completed_at,
    'note', v_todo.note, 'updatedAt', v_todo.updated_at);
end;
$$;

create or replace function public.resolve_project_next_action_with_todo(
  p_action_id bigint, p_action_updated_at timestamptz, p_resolution text,
  p_next_action_id bigint, p_next_action_content text, p_waiting_for text, p_review_on date,
  p_todo_id bigint, p_todo_updated_at timestamptz, p_todo_status text, p_terminal text
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_project_id bigint; v_link_id bigint; v_todo public.scheduled_actions%rowtype; v_at timestamptz := clock_timestamp();
begin
  v_project_id := public.lock_project_action_group(p_action_id);
  if not exists(select 1 from public.project_actions where id = p_action_id and updated_at = p_action_updated_at) then raise exception 'ACTION_CONFLICT'; end if;
  select scheduled_action_id into v_link_id from public.project_action_todos where project_action_id = p_action_id;
  if v_link_id is not null then
    if v_link_id is distinct from p_todo_id then raise exception 'TODO_SNAPSHOT_REQUIRED'; end if;
    select * into v_todo from public.scheduled_actions where id = v_link_id for update;
    perform 1 from public.project_action_todos where project_action_id = p_action_id for update;
    if v_todo.updated_at is distinct from p_todo_updated_at or v_todo.status is distinct from p_todo_status or v_todo.status <> 'pending' then raise exception 'TODO_CONFLICT'; end if;
  elsif p_todo_id is not null then raise exception 'TODO_LINK_CONFLICT';
  end if;
  perform public.finish_project_next_action(p_action_id, p_terminal, v_at,
    jsonb_build_object('resolution',p_resolution,'nextActionId',p_next_action_id,'nextActionContent',p_next_action_content,'waitingFor',p_waiting_for,'reviewOn',p_review_on));
  if v_link_id is not null then
    update public.scheduled_actions set status = case when p_terminal = 'done' then 'completed' else 'skipped' end,
      completed_at = case when p_terminal = 'done' then v_at else null end, updated_at = clock_timestamp() where id = v_link_id;
  end if;
  return v_project_id;
end;
$$;

-- Preserve the existing seven-argument endpoint for unlinked clients.
create or replace function public.resolve_project_next_action(
  p_action_id bigint, p_action_updated_at timestamptz, p_resolution text,
  p_next_action_id bigint, p_next_action_content text, p_waiting_for text, p_review_on date
)
returns bigint language sql security invoker set search_path = public as $$
  select public.resolve_project_next_action_with_todo(p_action_id,p_action_updated_at,p_resolution,
    p_next_action_id,p_next_action_content,p_waiting_for,p_review_on,null,null,null,'done');
$$;

create or replace function public.update_project_action_with_todo(
  p_action_id bigint, p_action_updated_at timestamptz, p_operation text, p_content text,
  p_due_on date, p_start_on date, p_milestone_id bigint,
  p_todo_id bigint, p_todo_updated_at timestamptz, p_todo_status text
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_project_id bigint; v_action public.project_actions%rowtype; v_project public.projects%rowtype;
  v_neighbour public.project_actions%rowtype; v_todo public.scheduled_actions%rowtype;
  v_link_id bigint; v_at timestamptz := clock_timestamp();
begin
  v_project_id := public.lock_project_action_group(p_action_id);
  select * into v_project from public.projects where id = v_project_id;
  select * into v_action from public.project_actions where id = p_action_id and updated_at = p_action_updated_at;
  if not found then raise exception 'ACTION_CONFLICT'; end if;
  if v_project.status in ('completed','dropped') then raise exception 'PROJECT_NOT_OPEN'; end if;
  select scheduled_action_id into v_link_id from public.project_action_todos where project_action_id = p_action_id;
  if v_link_id is not null then
    if v_link_id is distinct from p_todo_id then raise exception 'TODO_SNAPSHOT_REQUIRED'; end if;
    select * into v_todo from public.scheduled_actions where id = v_link_id for update;
    perform 1 from public.project_action_todos where project_action_id = p_action_id for update;
    if v_todo.updated_at is distinct from p_todo_updated_at or v_todo.status is distinct from p_todo_status or v_todo.status <> 'pending' then raise exception 'TODO_CONFLICT'; end if;
  elsif p_todo_id is not null then raise exception 'TODO_LINK_CONFLICT';
  end if;
  if p_operation = 'edit' then
    if v_action.status not in ('next','queued','waiting') then raise exception 'ACTION_CONFLICT'; end if;
    if nullif(btrim(p_content),'') is null then raise exception 'ACTION_CONTENT_REQUIRED'; end if;
    if v_link_id is not null and (p_due_on is distinct from v_action.due_on or p_start_on is distinct from v_action.start_on) then raise exception 'TODO_DATES_OWNED'; end if;
    if p_start_on is not null and p_due_on is not null and p_start_on > p_due_on then raise exception 'ACTION_DATES_INVALID'; end if;
    if p_milestone_id is not null and not exists(select 1 from public.project_milestones where id = p_milestone_id and project_id = v_project_id) then raise exception 'ACTION_MILESTONE_INVALID'; end if;
    update public.project_actions set content = btrim(p_content), due_on = p_due_on, start_on = p_start_on,
      milestone_id = p_milestone_id, updated_at = clock_timestamp() where id = p_action_id;
  elsif p_operation in ('complete','cancel') then
    if v_action.status not in ('queued','waiting') then raise exception 'ACTION_CONFLICT'; end if;
    update public.project_actions set status = case when p_operation = 'complete' then 'done' else 'cancelled' end,
      completed_at = case when p_operation = 'complete' then v_at else null end,
      waiting_for = null, sort_order = null, updated_at = clock_timestamp() where id = p_action_id;
    if v_link_id is not null then
      update public.scheduled_actions set status = case when p_operation = 'complete' then 'completed' else 'skipped' end,
        completed_at = case when p_operation = 'complete' then v_at else null end, updated_at = clock_timestamp() where id = v_link_id;
    end if;
  elsif p_operation = 'pin' then
    if v_action.status <> 'queued' then raise exception 'ACTION_CONFLICT'; end if;
    if v_project.status <> 'active' then raise exception 'PROJECT_NOT_ACTIVE'; end if;
    update public.project_actions set status = 'queued', sort_order = 0, updated_at = clock_timestamp() where project_id = v_project_id and status = 'next';
    update public.project_actions set status = 'next', sort_order = null, updated_at = clock_timestamp() where id = p_action_id;
  elsif p_operation in ('move_up','move_down') then
    if v_action.status <> 'queued' then raise exception 'ACTION_CONFLICT'; end if;
    with ranked as (select id, row_number() over(order by sort_order asc nulls last,created_at,id)::integer as pos from public.project_actions where project_id = v_project_id and status = 'queued')
      update public.project_actions a set sort_order = ranked.pos from ranked where a.id = ranked.id and a.sort_order is distinct from ranked.pos;
    select * into v_action from public.project_actions where id = p_action_id;
    if p_operation = 'move_up' then
      select * into v_neighbour from public.project_actions where project_id = v_project_id and status = 'queued'
        and milestone_id is not distinct from v_action.milestone_id and sort_order < v_action.sort_order order by sort_order desc limit 1;
    else
      select * into v_neighbour from public.project_actions where project_id = v_project_id and status = 'queued'
        and milestone_id is not distinct from v_action.milestone_id and sort_order > v_action.sort_order order by sort_order asc limit 1;
    end if;
    if not found then raise exception 'ACTION_MOVE_OUT_OF_RANGE'; end if;
    update public.project_actions set sort_order = v_neighbour.sort_order, updated_at = clock_timestamp() where id = v_action.id;
    update public.project_actions set sort_order = v_action.sort_order, updated_at = clock_timestamp() where id = v_neighbour.id;
  else raise exception 'ACTION_OPERATION_INVALID';
  end if;
  update public.projects set updated_at = clock_timestamp() where id = v_project_id;
  return v_project_id;
end;
$$;

create or replace function public.update_project_action(
  p_action_id bigint, p_action_updated_at timestamptz, p_operation text, p_content text,
  p_due_on date, p_start_on date, p_milestone_id bigint default null
)
returns bigint language sql security invoker set search_path = public as $$
  select public.update_project_action_with_todo(p_action_id,p_action_updated_at,p_operation,p_content,
    p_due_on,p_start_on,p_milestone_id,null,null,null);
$$;

-- Calendar cancellation only owns the ToDo lock. It never acquires Project
-- locks, so it cannot reverse the group -> Project -> ToDo order.
create or replace function public.delete_unlinked_scheduled_actions(p_ids bigint[], p_synced_at timestamptz)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_todo public.scheduled_actions%rowtype; v_deleted integer := 0;
begin
  for v_todo in select * from public.scheduled_actions where id = any(p_ids) order by id for update loop
    if exists(select 1 from public.project_action_todos where scheduled_action_id = v_todo.id)
      or exists(select 1 from public.scheduled_action_schedule_history where scheduled_action_id = v_todo.id)
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

revoke all on function public.lock_project_action_group(bigint) from public, anon, authenticated;
revoke all on function public.finish_project_next_action(bigint,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.link_project_action_todo(jsonb) from public, anon, authenticated;
revoke all on function public.unlink_project_action_todo(jsonb) from public, anon, authenticated;
revoke all on function public.update_linked_todo(jsonb) from public, anon, authenticated;
revoke all on function public.resolve_project_next_action_with_todo(bigint,timestamptz,text,bigint,text,text,date,bigint,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.update_project_action_with_todo(bigint,timestamptz,text,text,date,date,bigint,bigint,timestamptz,text) from public, anon, authenticated;
revoke all on function public.delete_unlinked_scheduled_actions(bigint[],timestamptz) from public, anon, authenticated;
grant execute on function public.lock_project_action_group(bigint), public.finish_project_next_action(bigint,text,timestamptz,jsonb),
  public.link_project_action_todo(jsonb), public.unlink_project_action_todo(jsonb), public.update_linked_todo(jsonb),
  public.resolve_project_next_action_with_todo(bigint,timestamptz,text,bigint,text,text,date,bigint,timestamptz,text,text),
  public.update_project_action_with_todo(bigint,timestamptz,text,text,date,date,bigint,bigint,timestamptz,text),
  public.delete_unlinked_scheduled_actions(bigint[],timestamptz) to service_role;
revoke all on function public.resolve_project_next_action(bigint,timestamptz,text,bigint,text,text,date) from public, anon, authenticated;
revoke all on function public.update_project_action(bigint,timestamptz,text,text,date,date,bigint) from public, anon, authenticated;
grant execute on function public.resolve_project_next_action(bigint,timestamptz,text,bigint,text,text,date),
  public.update_project_action(bigint,timestamptz,text,text,date,date,bigint) to service_role;

-- Milestone deletion updates Actions, so it must use the same lock order.
create or replace function public.update_project_milestone(
  p_project_id bigint,
  p_project_updated_at timestamptz,
  p_milestone_id bigint,
  p_milestone_updated_at timestamptz,
  p_operation text,
  p_title text,
  p_due_on date
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_milestone public.project_milestones%rowtype;
  v_neighbour public.project_milestones%rowtype;
  v_milestone_id bigint;
begin
  -- Match Action/link operations before any Project/milestone lock.
  perform 1 from public.project_actions where project_id = p_project_id order by id for update;
  select * into v_project
  from public.projects
  where id = p_project_id
  for update;
  if not found then
    raise exception 'PROJECT_CONFLICT';
  end if;
  if v_project.status in ('completed', 'dropped') then
    raise exception 'PROJECT_NOT_OPEN';
  end if;

  if p_operation = 'create' then
    if v_project.updated_at <> p_project_updated_at then
      raise exception 'PROJECT_CONFLICT';
    end if;
    if nullif(btrim(p_title), '') is null then
      raise exception 'MILESTONE_TITLE_REQUIRED';
    end if;
    insert into public.project_milestones (project_id, title, due_on, sort_order)
    values (
      p_project_id,
      btrim(p_title),
      p_due_on,
      coalesce((select max(sort_order) from public.project_milestones where project_id = p_project_id), 0) + 1
    )
    returning id into v_milestone_id;
  else
    select * into v_milestone
    from public.project_milestones
    where id = p_milestone_id and project_id = p_project_id and updated_at = p_milestone_updated_at
    for update;
    if not found then
      raise exception 'MILESTONE_CONFLICT';
    end if;
    v_milestone_id := v_milestone.id;

    if p_operation = 'edit' then
      if nullif(btrim(p_title), '') is null then
        raise exception 'MILESTONE_TITLE_REQUIRED';
      end if;
      update public.project_milestones
      set title = btrim(p_title), due_on = p_due_on, updated_at = now()
      where id = v_milestone.id;
    elsif p_operation = 'complete' then
      update public.project_milestones
      set status = 'done', completed_at = now(), updated_at = now()
      where id = v_milestone.id and status = 'open';
    elsif p_operation = 'reopen' then
      update public.project_milestones
      set status = 'open', completed_at = null, updated_at = now()
      where id = v_milestone.id and status = 'done';
    elsif p_operation in ('move_up', 'move_down') then
      -- Renumber first so equal or missing positions never block a swap.
      with ranked as (
        select id, row_number() over (order by sort_order asc, id asc)::integer as position
        from public.project_milestones
        where project_id = p_project_id
      )
      update public.project_milestones as milestone
      set sort_order = ranked.position
      from ranked
      where milestone.id = ranked.id and milestone.sort_order <> ranked.position;

      select * into v_milestone from public.project_milestones where id = v_milestone_id;
      select * into v_neighbour
      from public.project_milestones
      where project_id = p_project_id
        and sort_order = v_milestone.sort_order + case when p_operation = 'move_up' then -1 else 1 end;
      if not found then
        raise exception 'MILESTONE_MOVE_OUT_OF_RANGE';
      end if;
      update public.project_milestones set sort_order = v_neighbour.sort_order, updated_at = now() where id = v_milestone.id;
      update public.project_milestones set sort_order = v_milestone.sort_order, updated_at = now() where id = v_neighbour.id;
    elsif p_operation = 'delete' then
      update public.project_actions
      set milestone_id = null, updated_at = now()
      where milestone_id = v_milestone.id;
      delete from public.project_milestones where id = v_milestone.id;
    else
      raise exception 'MILESTONE_OPERATION_INVALID';
    end if;
  end if;

  update public.projects
  set updated_at = now()
  where id = p_project_id;

  return v_milestone_id;
end;
$$;
