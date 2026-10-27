begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(304308);
do $projects_release_guard$ begin
    if exists(select 1 from supabase_migrations.schema_migrations where version='20261027030001') then raise exception 'PROJECTS_MIGRATION_ALREADY_RECORDED'; end if;
    if to_regclass('public.project_goal_requests') is not null then raise exception 'PROJECTS_NEW_TABLE_ALREADY_EXISTS'; end if;
    if to_regclass('public.project_reviews') is not null then raise exception 'PROJECTS_NEW_TABLE_ALREADY_EXISTS'; end if;
  end; $projects_release_guard$;
-- Goal capture, independent review records and bounded portfolio projections.
create table if not exists public.project_goal_requests (
  request_id uuid primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  operation text not null check (operation in ('capture','review')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.project_reviews (
  project_id bigint primary key references public.projects(id) on delete cascade,
  reviewed_at timestamptz not null,
  fingerprint text not null
);
alter table public.project_goal_requests enable row level security;
alter table public.project_reviews enable row level security;
revoke all on public.project_goal_requests,public.project_reviews from public,anon,authenticated,service_role;
grant select,insert on public.project_goal_requests to service_role;
grant select,insert,update on public.project_reviews to service_role;

-- Only meaningful state is hashed. Read-cache freshness timestamps and review
-- records are excluded: reading or marking reviewed must never create progress.
-- The supporting-habit projection is filled after the relation migration.
create or replace function public.project_habit_review_fingerprint(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $$ select '[]'::jsonb; $$;
create or replace function public.project_review_fingerprint(p_project_id bigint)
returns text language sql stable security invoker set search_path=public as $$
  select md5(jsonb_build_object(
    'project',to_jsonb(p),
    'habits',public.project_habit_review_fingerprint(p.id),
    'actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
      from public.project_actions a where a.project_id=p.id),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(to_jsonb(m) order by m.id)
      from public.project_milestones m where m.project_id=p.id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
      from public.project_items i where i.project_id=p.id),'[]'::jsonb),
    'todos',coalesce((select jsonb_agg(jsonb_build_object('actionId',a.id,
      'todo',to_jsonb(t),'effectiveDate',c.effective_date,'schedule',c.schedule) order by a.id)
      from public.project_actions a join public.project_action_todos l on l.project_action_id=a.id
      join public.scheduled_actions t on t.id=l.scheduled_action_id
      left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
      where a.project_id=p.id),'[]'::jsonb)
  )::text) from public.projects p where p.id=p_project_id;
$$;

create or replace function public.get_project_goal_status(p_project_ids bigint[],p_today date)
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId',p.id,'projectUpdatedAt',p.updated_at,
    'fingerprint',public.project_review_fingerprint(p.id),
    'lastReviewedAt',r.reviewed_at,
    'reviewCurrent',coalesce(r.fingerprint=public.project_review_fingerprint(p.id),false),
    'weekDone',(select count(*) from public.project_actions a where a.project_id=p.id
      and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date >=
        p_today-(extract(isodow from p_today)::integer-1)),
    'nextMilestone',(select jsonb_build_object('id',m.id,'title',m.title,'dueOn',m.due_on)
      from public.project_milestones m where m.project_id=p.id and m.status='open'
      order by m.sort_order,m.id limit 1)
  ) order by p.id),'[]'::jsonb)
  from public.projects p left join public.project_reviews r on r.project_id=p.id
  where p.id=any(p_project_ids) and cardinality(p_project_ids)<=100;
$$;

create or replace function public.capture_project_action(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_request_id uuid := (p_request->>'requestId')::uuid;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_project public.projects%rowtype;
  v_previous public.project_goal_requests%rowtype;
  v_action_id bigint;
  v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request-array['requestId','projectId','projectUpdatedAt','content'])<>'{}'::jsonb
    or v_request_id is null or v_project_id is null or v_project_id<=0
    or nullif(p_request->>'projectUpdatedAt','') is null
    or nullif(btrim(p_request->>'content'),'') is null
    or char_length(btrim(p_request->>'content'))>500 then raise exception 'GOAL_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_previous from public.project_goal_requests where request_id=v_request_id;
  if found then
    if v_previous.operation<>'capture' or v_previous.payload<>p_request then raise exception 'GOAL_REQUEST_CONFLICT'; end if;
    return v_previous.result;
  end if;
  select * into v_project from public.projects where id=v_project_id for update;
  if not found or v_project.updated_at<>(p_request->>'projectUpdatedAt')::timestamptz then raise exception 'PROJECT_CONFLICT'; end if;
  if v_project.status not in ('active','waiting','on_hold') then raise exception 'PROJECT_NOT_OPEN'; end if;
  insert into public.project_actions(project_id,content,status,sort_order)
    values(v_project_id,btrim(p_request->>'content'),'queued',
      coalesce((select max(sort_order) from public.project_actions where project_id=v_project_id and status='queued'),0)+1)
    returning id into v_action_id;
  update public.projects set updated_at=clock_timestamp() where id=v_project_id;
  v_result:=jsonb_build_object('projectId',v_project_id,'actionId',v_action_id,'saved',true);
  insert into public.project_goal_requests(request_id,project_id,operation,payload,result)
    values(v_request_id,v_project_id,'capture',p_request,v_result);
  return v_result;
end;
$$;

create or replace function public.record_project_review(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_request_id uuid := (p_request->>'requestId')::uuid;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_project public.projects%rowtype;
  v_previous public.project_goal_requests%rowtype;
  v_fingerprint text;
  v_reviewed_at timestamptz;
  v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request-array['requestId','projectId','projectUpdatedAt','fingerprint'])<>'{}'::jsonb
    or v_request_id is null or v_project_id is null or v_project_id<=0
    or nullif(p_request->>'projectUpdatedAt','') is null
    or (p_request->>'fingerprint') is null or (p_request->>'fingerprint') !~ '^[0-9a-f]{32}$'
    then raise exception 'GOAL_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_previous from public.project_goal_requests where request_id=v_request_id;
  if found then
    if v_previous.operation<>'review' or v_previous.payload<>p_request then raise exception 'GOAL_REQUEST_CONFLICT'; end if;
    return v_previous.result;
  end if;
  -- Match the existing Action -> Project -> ToDo lock order. Project-only
  -- mutations finish before this check or invalidate the stored fingerprint.
  perform 1 from public.project_actions where project_id=v_project_id order by id for update;
  select * into v_project from public.projects where id=v_project_id for update;
  if not found or v_project.updated_at<>(p_request->>'projectUpdatedAt')::timestamptz then raise exception 'PROJECT_CONFLICT'; end if;
  if v_project.status<>'active' then raise exception 'PROJECT_NOT_ACTIVE'; end if;
  perform 1 from public.scheduled_actions t where exists(
    select 1 from public.project_actions a join public.project_action_todos l on l.project_action_id=a.id
    where a.project_id=v_project_id and l.scheduled_action_id=t.id) order by t.id for update;
  v_fingerprint:=public.project_review_fingerprint(v_project_id);
  if v_fingerprint<>p_request->>'fingerprint' then raise exception 'GOAL_REVIEW_CONFLICT'; end if;
  v_reviewed_at:=clock_timestamp();
  insert into public.project_reviews(project_id,reviewed_at,fingerprint)
    values(v_project_id,v_reviewed_at,v_fingerprint)
    on conflict(project_id) do update set reviewed_at=excluded.reviewed_at,fingerprint=excluded.fingerprint;
  v_result:=jsonb_build_object('projectId',v_project_id,'lastReviewedAt',v_reviewed_at,'saved',true);
  insert into public.project_goal_requests(request_id,project_id,operation,payload,result)
    values(v_request_id,v_project_id,'review',p_request,v_result);
  return v_result;
end;
$$;
revoke all on function public.project_habit_review_fingerprint(bigint),public.project_review_fingerprint(bigint),public.get_project_goal_status(bigint[],date),
  public.capture_project_action(jsonb),public.record_project_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.project_habit_review_fingerprint(bigint),public.project_review_fingerprint(bigint),public.get_project_goal_status(bigint[],date),
  public.capture_project_action(jsonb),public.record_project_review(jsonb) to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements)
  values('20261027030001','project_goal_capture_review',array[$projects_source_20261027030001$-- Goal capture, independent review records and bounded portfolio projections.
create table if not exists public.project_goal_requests (
  request_id uuid primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  operation text not null check (operation in ('capture','review')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.project_reviews (
  project_id bigint primary key references public.projects(id) on delete cascade,
  reviewed_at timestamptz not null,
  fingerprint text not null
);
alter table public.project_goal_requests enable row level security;
alter table public.project_reviews enable row level security;
revoke all on public.project_goal_requests,public.project_reviews from public,anon,authenticated,service_role;
grant select,insert on public.project_goal_requests to service_role;
grant select,insert,update on public.project_reviews to service_role;

-- Only meaningful state is hashed. Read-cache freshness timestamps and review
-- records are excluded: reading or marking reviewed must never create progress.
-- The supporting-habit projection is filled after the relation migration.
create or replace function public.project_habit_review_fingerprint(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $$ select '[]'::jsonb; $$;
create or replace function public.project_review_fingerprint(p_project_id bigint)
returns text language sql stable security invoker set search_path=public as $$
  select md5(jsonb_build_object(
    'project',to_jsonb(p),
    'habits',public.project_habit_review_fingerprint(p.id),
    'actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
      from public.project_actions a where a.project_id=p.id),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(to_jsonb(m) order by m.id)
      from public.project_milestones m where m.project_id=p.id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
      from public.project_items i where i.project_id=p.id),'[]'::jsonb),
    'todos',coalesce((select jsonb_agg(jsonb_build_object('actionId',a.id,
      'todo',to_jsonb(t),'effectiveDate',c.effective_date,'schedule',c.schedule) order by a.id)
      from public.project_actions a join public.project_action_todos l on l.project_action_id=a.id
      join public.scheduled_actions t on t.id=l.scheduled_action_id
      left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
      where a.project_id=p.id),'[]'::jsonb)
  )::text) from public.projects p where p.id=p_project_id;
$$;

create or replace function public.get_project_goal_status(p_project_ids bigint[],p_today date)
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId',p.id,'projectUpdatedAt',p.updated_at,
    'fingerprint',public.project_review_fingerprint(p.id),
    'lastReviewedAt',r.reviewed_at,
    'reviewCurrent',coalesce(r.fingerprint=public.project_review_fingerprint(p.id),false),
    'weekDone',(select count(*) from public.project_actions a where a.project_id=p.id
      and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date >=
        p_today-(extract(isodow from p_today)::integer-1)),
    'nextMilestone',(select jsonb_build_object('id',m.id,'title',m.title,'dueOn',m.due_on)
      from public.project_milestones m where m.project_id=p.id and m.status='open'
      order by m.sort_order,m.id limit 1)
  ) order by p.id),'[]'::jsonb)
  from public.projects p left join public.project_reviews r on r.project_id=p.id
  where p.id=any(p_project_ids) and cardinality(p_project_ids)<=100;
$$;

create or replace function public.capture_project_action(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_request_id uuid := (p_request->>'requestId')::uuid;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_project public.projects%rowtype;
  v_previous public.project_goal_requests%rowtype;
  v_action_id bigint;
  v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request-array['requestId','projectId','projectUpdatedAt','content'])<>'{}'::jsonb
    or v_request_id is null or v_project_id is null or v_project_id<=0
    or nullif(p_request->>'projectUpdatedAt','') is null
    or nullif(btrim(p_request->>'content'),'') is null
    or char_length(btrim(p_request->>'content'))>500 then raise exception 'GOAL_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_previous from public.project_goal_requests where request_id=v_request_id;
  if found then
    if v_previous.operation<>'capture' or v_previous.payload<>p_request then raise exception 'GOAL_REQUEST_CONFLICT'; end if;
    return v_previous.result;
  end if;
  select * into v_project from public.projects where id=v_project_id for update;
  if not found or v_project.updated_at<>(p_request->>'projectUpdatedAt')::timestamptz then raise exception 'PROJECT_CONFLICT'; end if;
  if v_project.status not in ('active','waiting','on_hold') then raise exception 'PROJECT_NOT_OPEN'; end if;
  insert into public.project_actions(project_id,content,status,sort_order)
    values(v_project_id,btrim(p_request->>'content'),'queued',
      coalesce((select max(sort_order) from public.project_actions where project_id=v_project_id and status='queued'),0)+1)
    returning id into v_action_id;
  update public.projects set updated_at=clock_timestamp() where id=v_project_id;
  v_result:=jsonb_build_object('projectId',v_project_id,'actionId',v_action_id,'saved',true);
  insert into public.project_goal_requests(request_id,project_id,operation,payload,result)
    values(v_request_id,v_project_id,'capture',p_request,v_result);
  return v_result;
end;
$$;

create or replace function public.record_project_review(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_request_id uuid := (p_request->>'requestId')::uuid;
  v_project_id bigint := (p_request->>'projectId')::bigint;
  v_project public.projects%rowtype;
  v_previous public.project_goal_requests%rowtype;
  v_fingerprint text;
  v_reviewed_at timestamptz;
  v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or (p_request-array['requestId','projectId','projectUpdatedAt','fingerprint'])<>'{}'::jsonb
    or v_request_id is null or v_project_id is null or v_project_id<=0
    or nullif(p_request->>'projectUpdatedAt','') is null
    or (p_request->>'fingerprint') is null or (p_request->>'fingerprint') !~ '^[0-9a-f]{32}$'
    then raise exception 'GOAL_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_previous from public.project_goal_requests where request_id=v_request_id;
  if found then
    if v_previous.operation<>'review' or v_previous.payload<>p_request then raise exception 'GOAL_REQUEST_CONFLICT'; end if;
    return v_previous.result;
  end if;
  -- Match the existing Action -> Project -> ToDo lock order. Project-only
  -- mutations finish before this check or invalidate the stored fingerprint.
  perform 1 from public.project_actions where project_id=v_project_id order by id for update;
  select * into v_project from public.projects where id=v_project_id for update;
  if not found or v_project.updated_at<>(p_request->>'projectUpdatedAt')::timestamptz then raise exception 'PROJECT_CONFLICT'; end if;
  if v_project.status<>'active' then raise exception 'PROJECT_NOT_ACTIVE'; end if;
  perform 1 from public.scheduled_actions t where exists(
    select 1 from public.project_actions a join public.project_action_todos l on l.project_action_id=a.id
    where a.project_id=v_project_id and l.scheduled_action_id=t.id) order by t.id for update;
  v_fingerprint:=public.project_review_fingerprint(v_project_id);
  if v_fingerprint<>p_request->>'fingerprint' then raise exception 'GOAL_REVIEW_CONFLICT'; end if;
  v_reviewed_at:=clock_timestamp();
  insert into public.project_reviews(project_id,reviewed_at,fingerprint)
    values(v_project_id,v_reviewed_at,v_fingerprint)
    on conflict(project_id) do update set reviewed_at=excluded.reviewed_at,fingerprint=excluded.fingerprint;
  v_result:=jsonb_build_object('projectId',v_project_id,'lastReviewedAt',v_reviewed_at,'saved',true);
  insert into public.project_goal_requests(request_id,project_id,operation,payload,result)
    values(v_request_id,v_project_id,'review',p_request,v_result);
  return v_result;
end;
$$;
revoke all on function public.project_habit_review_fingerprint(bigint),public.project_review_fingerprint(bigint),public.get_project_goal_status(bigint[],date),
  public.capture_project_action(jsonb),public.record_project_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.project_habit_review_fingerprint(bigint),public.project_review_fingerprint(bigint),public.get_project_goal_status(bigint[],date),
  public.capture_project_action(jsonb),public.record_project_review(jsonb) to service_role;
$projects_source_20261027030001$]::text[]);
notify pgrst,'reload schema';
commit;
