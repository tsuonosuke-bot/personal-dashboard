-- Lets the Projects screen edit, complete, cancel, reorder and pin individual
-- actions (#153). Actions get a start date next to the existing due date, and
-- queued actions keep an explicit order. "next" keeps its one-per-project
-- index and now means the pinned "do this now" action.

alter table public.project_actions
  add column if not exists start_on date,
  add column if not exists sort_order integer;

alter table public.project_actions
  drop constraint if exists project_actions_start_before_due;
alter table public.project_actions
  add constraint project_actions_start_before_due
  check (start_on is null or due_on is null or start_on <= due_on);

comment on column public.project_actions.start_on is
  'Local date from which the action should be started. Null when not planned.';
comment on column public.project_actions.sort_order is
  'Position among the project''s queued actions (ascending). Null rows sort last by created_at.';

-- Give existing queued actions the order they were added in.
with ranked as (
  select id, row_number() over (partition by project_id order by created_at asc, id asc)::integer as position
  from public.project_actions
  where status = 'queued'
)
update public.project_actions as action
set sort_order = ranked.position
from ranked
where action.id = ranked.id and action.sort_order is null;

-- p_operation:
--   edit       content / due_on / start_on of a next, queued or waiting action
--   complete   queued or waiting action -> done (the next action keeps using
--              resolve_project_next_action, which also decides the project's state)
--   cancel     queued or waiting action -> cancelled
--   pin        queued action -> next; the current next action, if any, goes back
--              to the top of the queue. The project must be active.
--   move_up / move_down   swap a queued action with its neighbour
create or replace function public.update_project_action(
  p_action_id bigint,
  p_action_updated_at timestamptz,
  p_operation text,
  p_content text,
  p_due_on date,
  p_start_on date
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id bigint;
  v_action public.project_actions%rowtype;
  v_project public.projects%rowtype;
  v_neighbour public.project_actions%rowtype;
  v_position integer;
begin
  select project_id into v_project_id
  from public.project_actions
  where id = p_action_id;
  if not found then
    raise exception 'ACTION_CONFLICT';
  end if;

  -- Lock every open action of the project in id order before the project row,
  -- so this never waits on the project while holding an action that
  -- resolve_project_next_action (action -> project) needs.
  perform 1
  from public.project_actions
  where project_id = v_project_id and status in ('next', 'queued', 'waiting')
  order by id
  for update;

  select * into v_project
  from public.projects
  where id = v_project_id
  for update;

  select * into v_action
  from public.project_actions
  where id = p_action_id and updated_at = p_action_updated_at;
  if not found then
    raise exception 'ACTION_CONFLICT';
  end if;
  if v_project.status in ('completed', 'dropped') then
    raise exception 'PROJECT_NOT_OPEN';
  end if;

  if p_operation = 'edit' then
    if v_action.status not in ('next', 'queued', 'waiting') then
      raise exception 'ACTION_CONFLICT';
    end if;
    if nullif(btrim(p_content), '') is null then
      raise exception 'ACTION_CONTENT_REQUIRED';
    end if;
    if p_start_on is not null and p_due_on is not null and p_start_on > p_due_on then
      raise exception 'ACTION_DATES_INVALID';
    end if;
    update public.project_actions
    set content = btrim(p_content), due_on = p_due_on, start_on = p_start_on, updated_at = now()
    where id = v_action.id;

  elsif p_operation in ('complete', 'cancel') then
    if v_action.status not in ('queued', 'waiting') then
      raise exception 'ACTION_CONFLICT';
    end if;
    update public.project_actions
    set status = case when p_operation = 'complete' then 'done' else 'cancelled' end,
        completed_at = case when p_operation = 'complete' then now() else null end,
        waiting_for = null,
        sort_order = null,
        updated_at = now()
    where id = v_action.id;

  elsif p_operation = 'pin' then
    if v_action.status <> 'queued' then
      raise exception 'ACTION_CONFLICT';
    end if;
    if v_project.status <> 'active' then
      raise exception 'PROJECT_NOT_ACTIVE';
    end if;
    update public.project_actions
    set status = 'queued', sort_order = 0, updated_at = now()
    where project_id = v_project.id and status = 'next';
    update public.project_actions
    set status = 'next', sort_order = null, updated_at = now()
    where id = v_action.id;

  elsif p_operation in ('move_up', 'move_down') then
    if v_action.status <> 'queued' then
      raise exception 'ACTION_CONFLICT';
    end if;
    with ranked as (
      select id, row_number() over (order by sort_order asc nulls last, created_at asc, id asc)::integer as position
      from public.project_actions
      where project_id = v_project.id and status = 'queued'
    )
    update public.project_actions as action
    set sort_order = ranked.position
    from ranked
    where action.id = ranked.id and action.sort_order is distinct from ranked.position;

    select sort_order into v_position from public.project_actions where id = v_action.id;
    select * into v_neighbour
    from public.project_actions
    where project_id = v_project.id and status = 'queued'
      and sort_order = v_position + case when p_operation = 'move_up' then -1 else 1 end;
    if not found then
      raise exception 'ACTION_MOVE_OUT_OF_RANGE';
    end if;
    update public.project_actions set sort_order = v_neighbour.sort_order, updated_at = now() where id = v_action.id;
    update public.project_actions set sort_order = v_position, updated_at = now() where id = v_neighbour.id;

  else
    raise exception 'ACTION_OPERATION_INVALID';
  end if;

  update public.projects
  set updated_at = now()
  where id = v_project.id;

  return v_project.id;
end;
$$;

-- New queued actions go to the end of the queue.
create or replace function public.add_project_queued_action(
  p_project_id bigint,
  p_project_updated_at timestamptz,
  p_content text
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_action_id bigint;
begin
  select * into v_project
  from public.projects
  where id = p_project_id and updated_at = p_project_updated_at
  for update;

  if not found then
    raise exception 'PROJECT_CONFLICT';
  end if;
  if v_project.status <> 'active' then
    raise exception 'PROJECT_NOT_ACTIVE';
  end if;

  insert into public.project_actions (project_id, content, status, sort_order)
  values (
    p_project_id,
    btrim(p_content),
    'queued',
    coalesce((
      select max(sort_order) from public.project_actions
      where project_id = p_project_id and status = 'queued'
    ), 0) + 1
  )
  returning id into v_action_id;

  update public.projects
  set updated_at = now()
  where id = p_project_id;

  return v_action_id;
end;
$$;

revoke all on function public.update_project_action(bigint, timestamptz, text, text, date, date) from public, anon, authenticated;
grant execute on function public.update_project_action(bigint, timestamptz, text, text, date, date) to service_role;
