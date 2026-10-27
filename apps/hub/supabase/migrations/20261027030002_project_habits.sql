-- #307: one exercise Habit may support both fitness and event preparation.
-- This many-to-many relation owns no repetition, execution count or Action.
create table if not exists public.project_habits (
  project_id bigint not null references public.projects(id) on delete cascade,
  habit_id bigint not null references public.habits(id) on delete restrict,
  linked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (project_id, habit_id)
);
create index if not exists project_habits_habit_id_idx on public.project_habits(habit_id);
comment on table public.project_habits is
  'M:N explicit links only. Habits/habit_logs remain canonical; unlinking or completing a Project never changes Habit execution or status.';
comment on column public.project_habits.linked is
  'False retains a relation tombstone so delayed retries cannot resurrect an unlinked pair.';
alter table public.project_habits enable row level security;
revoke all on public.project_habits from public, anon, authenticated, service_role;
grant select, insert, update on public.project_habits to service_role;

-- Only the relationship changes. Lock Project before Habit, with no Action locks
-- or updates, so the existing Action -> Project -> ToDo lock order stays intact.
create or replace function public.link_project_habit(p_request jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_project public.projects%rowtype;
  v_habit public.habits%rowtype;
  v_relation public.project_habits%rowtype;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_habit_id bigint := (p_request->>'habitId')::bigint;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or not (p_request ?& array['projectId','projectUpdatedAt','habitId','habitUpdatedAt','relationUpdatedAt'])
    or (p_request - array['projectId','projectUpdatedAt','habitId','habitUpdatedAt','relationUpdatedAt']) <> '{}'::jsonb then
    raise exception 'PROJECT_HABIT_INVALID';
  end if;
  select * into v_project from public.projects where id = v_project_id for update;
  if not found or v_project.updated_at is distinct from (p_request->>'projectUpdatedAt')::timestamptz then
    raise exception 'PROJECT_CONFLICT';
  end if;
  select * into v_habit from public.habits where id = v_habit_id for update;
  if not found or v_habit.updated_at is distinct from (p_request->>'habitUpdatedAt')::timestamptz then
    raise exception 'HABIT_CONFLICT';
  end if;
  -- A retry has the same result and never creates a second link or execution.
  select * into v_relation from public.project_habits
    where project_id = v_project_id and habit_id = v_habit_id for update;
  if found and v_relation.linked then return v_project_id; end if;
  if v_relation.updated_at is distinct from (p_request->>'relationUpdatedAt')::timestamptz then
    raise exception 'PROJECT_HABIT_CONFLICT';
  end if;
  if v_project.status in ('completed', 'dropped') then raise exception 'PROJECT_NOT_OPEN'; end if;
  insert into public.project_habits(project_id, habit_id) values(v_project_id, v_habit_id)
    on conflict (project_id, habit_id) do update set linked = true,
      updated_at = greatest(clock_timestamp(), public.project_habits.updated_at + interval '1 microsecond');
  return v_project_id;
end;
$$;

create or replace function public.unlink_project_habit(p_request jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_project public.projects%rowtype;
  v_habit public.habits%rowtype;
  v_relation public.project_habits%rowtype;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_habit_id bigint := (p_request->>'habitId')::bigint;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or not (p_request ?& array['projectId','projectUpdatedAt','habitId','habitUpdatedAt','relationUpdatedAt'])
    or (p_request - array['projectId','projectUpdatedAt','habitId','habitUpdatedAt','relationUpdatedAt']) <> '{}'::jsonb then
    raise exception 'PROJECT_HABIT_INVALID';
  end if;
  select * into v_project from public.projects where id = v_project_id for update;
  if not found or v_project.updated_at is distinct from (p_request->>'projectUpdatedAt')::timestamptz then
    raise exception 'PROJECT_CONFLICT';
  end if;
  select * into v_habit from public.habits where id = v_habit_id for update;
  if not found or v_habit.updated_at is distinct from (p_request->>'habitUpdatedAt')::timestamptz then
    raise exception 'HABIT_CONFLICT';
  end if;
  -- Terminal Projects can unlink. Tombstones prevent old POST/DELETE requests
  -- from resurrecting/removing a relationship after a later unlink/relink.
  select * into v_relation from public.project_habits
    where project_id = v_project_id and habit_id = v_habit_id for update;
  if not found or not v_relation.linked then return v_project_id; end if;
  if v_relation.updated_at is distinct from (p_request->>'relationUpdatedAt')::timestamptz then
    raise exception 'PROJECT_HABIT_CONFLICT';
  end if;
  update public.project_habits set linked = false,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where project_id = v_project_id and habit_id = v_habit_id;
  return v_project_id;
end;
$$;

revoke all on function public.link_project_habit(jsonb), public.unlink_project_habit(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.link_project_habit(jsonb), public.unlink_project_habit(jsonb) to service_role;
