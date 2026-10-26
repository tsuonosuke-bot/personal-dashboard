begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(275300);
do $performance_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026040133') then
    raise exception 'PERFORMANCE_MIGRATION_ALREADY_RECORDED: 20261026040133';
  end if;
end;
$performance_guard$;

-- List/search counts are calculated in PostgreSQL; record bodies are selected only
-- for the requested page or Project. Terminal Actions and related Items are paged.
create table if not exists public.project_todo_read_cache (
  scheduled_action_id bigint primary key references public.scheduled_actions(id) on delete cascade,
  todo_updated_at timestamptz not null,
  effective_date date not null,
  schedule jsonb,
  fetched_at timestamptz not null
);
alter table public.project_todo_read_cache add column if not exists schedule jsonb;
alter table public.project_todo_read_cache enable row level security;
revoke all on public.project_todo_read_cache from public,anon,authenticated;
grant select,insert,update on public.project_todo_read_cache to service_role;

-- This is a confirmed-read cache, not the ToDo source of truth. Older requests
-- and snapshots of a ToDo version that has since changed cannot overwrite it.
create or replace function public.record_project_todo_read_cache(p_items jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'TODO_CACHE_INPUT_INVALID'; end if;
  insert into public.project_todo_read_cache(scheduled_action_id,todo_updated_at,effective_date,schedule,fetched_at)
  select i.id,i.updated_at,i.effective_date,i.schedule,i.fetched_at
  from jsonb_to_recordset(p_items) as i(id bigint,updated_at timestamptz,effective_date date,schedule jsonb,fetched_at timestamptz)
  join public.scheduled_actions t on t.id=i.id and t.updated_at=i.updated_at
  where i.effective_date is not null and i.fetched_at is not null
  on conflict(scheduled_action_id) do update set todo_updated_at=excluded.todo_updated_at,
    effective_date=excluded.effective_date,schedule=excluded.schedule,fetched_at=excluded.fetched_at
  where public.project_todo_read_cache.fetched_at<=excluded.fetched_at;
end;
$$;
revoke all on function public.record_project_todo_read_cache(jsonb) from public,anon,authenticated;
grant execute on function public.record_project_todo_read_cache(jsonb) to service_role;

create or replace function public.get_project_read_model(
  p_view text default 'active', p_search text default '', p_offset integer default 0,
  p_limit integer default 50, p_project_id bigint default null,
  p_history_offset integer default 0, p_history_limit integer default 10,
  p_item_offset integer default 0, p_today date default (now() at time zone 'Asia/Tokyo')::date,
  p_attention boolean default false, p_sort text default 'recommended'
) returns jsonb language sql stable security invoker set search_path = public as $$
with action_stats as (
  select project_id, count(*) filter(where status in ('next','queued','waiting')) as open_count,
    count(*) filter(where status='queued') as queued_count,
    count(*) filter(where status='done') as done_count,
    count(*) filter(where status in ('done','cancelled')) as history_count,
    max(updated_at) as last_activity from public.project_actions group by project_id
), item_stats as (
  select project_id,count(*) as item_count,count(*) filter(where treatment='unprocessed') as unprocessed
  from public.project_items group by project_id
), milestone_stats as (
  select project_id,max(updated_at) as last_activity from public.project_milestones group by project_id
), enriched as (
  select p.*, coalesce(a.open_count,0) as open_count,coalesce(a.queued_count,0) as queued_count,
    coalesce(a.done_count,0) as done_count,coalesce(a.history_count,0) as history_count,
    coalesce(i.item_count,0) as item_count,coalesce(i.unprocessed,0) as unprocessed,
    ((p.status='active' and coalesce(a.open_count,0)=0) or coalesce(i.unprocessed,0)>0) as needs_attention,
    greatest(p.updated_at,a.last_activity,m.last_activity) as last_activity_at,
    (p.status='active' and p_today-(greatest(p.updated_at,a.last_activity,m.last_activity) at time zone 'Asia/Tokyo')::date >= 14) as stale
  from public.projects p left join action_stats a on a.project_id=p.id
    left join item_stats i on i.project_id=p.id left join milestone_stats m on m.project_id=p.id
), context_matching as (
  select p.* from enriched p where
      (p_view='review' and (p.status in ('active','waiting','on_hold') or p.needs_attention
        or exists(select 1 from public.project_actions a where a.project_id=p.id and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date>=p_today-((extract(isodow from p_today))::integer-1)))
       or p_view='all' or p_view='today' and (p.status in ('active','waiting','on_hold')
        or exists(select 1 from public.project_actions a where a.project_id=p.id and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date=p_today))
       or p_view='active' and p.status='active'
       or p_view='waiting' and p.status in ('waiting','on_hold') or p_view='completed' and p.status in ('completed','dropped'))
    and (not p_attention or p.needs_attention)
    and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',p.title,p.outcome,p.theme,
      (select string_agg(a.content,' ' order by case a.status when 'next' then 0 when 'queued' then 1 when 'waiting' then 2 when 'done' then 3 else 4 end,
        case when a.status='queued' then a.sort_order end asc nulls last,
        case when a.status='queued' then a.created_at end asc,case when a.status='queued' then a.id end asc,a.updated_at desc,a.id desc)
        from public.project_actions a where a.project_id=p.id),
      (select string_agg(i.source_content,' ' order by i.updated_at desc,i.id desc) from public.project_items i where i.project_id=p.id))))>0)
), matching as (
  select * from context_matching where p_project_id is null
  union all select * from enriched where p_project_id is not null and id=p_project_id
), selected as (
  select * from matching order by
    case when p_sort='updated' then updated_at end desc,
    case when p_sort='target' then target_on end asc nulls last,
    case when p_sort='review' then review_on end asc nulls last,
    needs_attention desc,case when p_sort='recommended' then target_on end asc nulls last,updated_at desc,id desc
  limit case when p_view in ('review','today') then null else greatest(1,least(p_limit,100)) end offset greatest(p_offset,0)
), selected_actions as (
  select a.* from public.project_actions a join selected p on p.id=a.project_id where
    (p_project_id is null and (a.status='next' or p_view in ('review','today') and
      (a.status in ('queued','waiting') or a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date >=
        case when p_view='today' then p_today else p_today-((extract(isodow from p_today))::integer-1) end)))
    or (p_project_id is not null and a.status in ('next','queued','waiting'))
  union all
  select h.* from selected p cross join lateral (
    select a.* from public.project_actions a where a.project_id=p.id and a.status in ('done','cancelled') and p_project_id is not null
    order by a.updated_at desc,a.id desc limit greatest(1,least(p_history_limit,100)) offset greatest(p_history_offset,0)
  ) h
), selected_items as (
  select i.* from selected p cross join lateral (
    select i.* from public.project_items i where i.project_id=p.id and p_project_id is not null
    order by i.updated_at desc,i.id desc limit 50 offset greatest(p_item_offset,0)
  ) i
), selected_milestones as (
  select m.* from public.project_milestones m join selected p on p.id=m.project_id
  where p_project_id is not null or exists(select 1 from selected_actions a where a.milestone_id=m.id)
), milestone_progress as (
  select a.milestone_id,count(*) filter(where a.status<>'cancelled') as total,
    count(*) filter(where a.status='done') as done from public.project_actions a
  join selected_milestones m on m.id=a.milestone_id group by a.milestone_id
)
select jsonb_build_object(
  'projects',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('context_matches',exists(select 1 from context_matching c where c.id=p.id))) from selected p),'[]'::jsonb),
  'actions',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('project_action_todos',
    (select jsonb_build_object('scheduled_action_id',l.scheduled_action_id) from public.project_action_todos l where l.project_action_id=a.id))) from selected_actions a),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.updated_at desc,i.id desc) from selected_items i),'[]'::jsonb),
  'milestones',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('total',coalesce(s.total,0),'done',coalesce(s.done,0))) from selected_milestones m left join milestone_progress s on s.milestone_id=m.id),'[]'::jsonb),
  'summary',(select jsonb_build_object('active',count(*) filter(where status='active'),'needsAttention',count(*) filter(where needs_attention),
    'stale',count(*) filter(where stale),'waiting',count(*) filter(where status in ('waiting','on_hold')),
    'completed',count(*) filter(where status='completed'),'openActions',coalesce(sum(open_count),0),'unprocessedItems',coalesce(sum(unprocessed),0),
    'reviewPending',count(*) filter(where status in ('active','waiting','on_hold') and target_on<p_today)
      +count(*) filter(where needs_attention)+count(*) filter(where stale)
      +count(*) filter(where status in ('waiting','on_hold') and review_on<=p_today)
      +(select count(*) from public.project_actions a join enriched p on p.id=a.project_id
        left join public.project_action_todos l on l.project_action_id=a.id left join public.scheduled_actions t on t.id=l.scheduled_action_id
        left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
        where p.status in ('active','waiting','on_hold') and a.status in ('next','queued')
          and coalesce(c.effective_date::text,t.current_schedule->>'date',a.due_on::text)<p_today::text)) from enriched),
  'reviewCalendarActions',coalesce((select jsonb_agg(jsonb_build_object('todoId',t.id,'projectId',a.project_id,
    'date',coalesce(c.effective_date::text,t.current_schedule->>'date'),
    'schedule',coalesce(c.schedule,t.current_schedule)||jsonb_build_object('date',coalesce(c.effective_date::text,t.current_schedule->>'date'))))
    from public.project_actions a join enriched p on p.id=a.project_id join public.project_action_todos l on l.project_action_id=a.id
    join public.scheduled_actions t on t.id=l.scheduled_action_id
    left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
    where p.status in ('active','waiting','on_hold') and a.status in ('next','queued')
      and (p_project_id is null or a.project_id=p_project_id)),'[]'::jsonb),
  'page',jsonb_build_object('view',p_view,'offset',p_offset,'total',(select count(*) from matching),
    'contextTotal',(select count(*) from context_matching),
    'hasMore',p_view not in ('review','today') and p_offset+(select count(*) from selected)<(select count(*) from matching),
    'historyOffset',p_history_offset,'historyHasMore',p_project_id is not null and p_history_offset+p_history_limit<coalesce((select history_count from selected limit 1),0),
    'itemOffset',p_item_offset,'itemsHasMore',p_project_id is not null and p_item_offset+50<coalesce((select item_count from selected limit 1),0))
);
$$;
revoke all on function public.get_project_read_model(text,text,integer,integer,bigint,integer,integer,integer,date,boolean,text) from public,anon,authenticated;
grant execute on function public.get_project_read_model(text,text,integer,integer,bigint,integer,integer,integer,date,boolean,text) to service_role;
create index if not exists project_actions_project_status_updated_idx on public.project_actions(project_id,status,updated_at desc,id desc);
create index if not exists project_items_project_updated_idx on public.project_items(project_id,updated_at desc,id desc);

insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20261026040133','project_read_model',array[$performance_source_20261026040133$-- List/search counts are calculated in PostgreSQL; record bodies are selected only
-- for the requested page or Project. Terminal Actions and related Items are paged.
create table if not exists public.project_todo_read_cache (
  scheduled_action_id bigint primary key references public.scheduled_actions(id) on delete cascade,
  todo_updated_at timestamptz not null,
  effective_date date not null,
  schedule jsonb,
  fetched_at timestamptz not null
);
alter table public.project_todo_read_cache add column if not exists schedule jsonb;
alter table public.project_todo_read_cache enable row level security;
revoke all on public.project_todo_read_cache from public,anon,authenticated;
grant select,insert,update on public.project_todo_read_cache to service_role;

-- This is a confirmed-read cache, not the ToDo source of truth. Older requests
-- and snapshots of a ToDo version that has since changed cannot overwrite it.
create or replace function public.record_project_todo_read_cache(p_items jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'TODO_CACHE_INPUT_INVALID'; end if;
  insert into public.project_todo_read_cache(scheduled_action_id,todo_updated_at,effective_date,schedule,fetched_at)
  select i.id,i.updated_at,i.effective_date,i.schedule,i.fetched_at
  from jsonb_to_recordset(p_items) as i(id bigint,updated_at timestamptz,effective_date date,schedule jsonb,fetched_at timestamptz)
  join public.scheduled_actions t on t.id=i.id and t.updated_at=i.updated_at
  where i.effective_date is not null and i.fetched_at is not null
  on conflict(scheduled_action_id) do update set todo_updated_at=excluded.todo_updated_at,
    effective_date=excluded.effective_date,schedule=excluded.schedule,fetched_at=excluded.fetched_at
  where public.project_todo_read_cache.fetched_at<=excluded.fetched_at;
end;
$$;
revoke all on function public.record_project_todo_read_cache(jsonb) from public,anon,authenticated;
grant execute on function public.record_project_todo_read_cache(jsonb) to service_role;

create or replace function public.get_project_read_model(
  p_view text default 'active', p_search text default '', p_offset integer default 0,
  p_limit integer default 50, p_project_id bigint default null,
  p_history_offset integer default 0, p_history_limit integer default 10,
  p_item_offset integer default 0, p_today date default (now() at time zone 'Asia/Tokyo')::date,
  p_attention boolean default false, p_sort text default 'recommended'
) returns jsonb language sql stable security invoker set search_path = public as $$
with action_stats as (
  select project_id, count(*) filter(where status in ('next','queued','waiting')) as open_count,
    count(*) filter(where status='queued') as queued_count,
    count(*) filter(where status='done') as done_count,
    count(*) filter(where status in ('done','cancelled')) as history_count,
    max(updated_at) as last_activity from public.project_actions group by project_id
), item_stats as (
  select project_id,count(*) as item_count,count(*) filter(where treatment='unprocessed') as unprocessed
  from public.project_items group by project_id
), milestone_stats as (
  select project_id,max(updated_at) as last_activity from public.project_milestones group by project_id
), enriched as (
  select p.*, coalesce(a.open_count,0) as open_count,coalesce(a.queued_count,0) as queued_count,
    coalesce(a.done_count,0) as done_count,coalesce(a.history_count,0) as history_count,
    coalesce(i.item_count,0) as item_count,coalesce(i.unprocessed,0) as unprocessed,
    ((p.status='active' and coalesce(a.open_count,0)=0) or coalesce(i.unprocessed,0)>0) as needs_attention,
    greatest(p.updated_at,a.last_activity,m.last_activity) as last_activity_at,
    (p.status='active' and p_today-(greatest(p.updated_at,a.last_activity,m.last_activity) at time zone 'Asia/Tokyo')::date >= 14) as stale
  from public.projects p left join action_stats a on a.project_id=p.id
    left join item_stats i on i.project_id=p.id left join milestone_stats m on m.project_id=p.id
), context_matching as (
  select p.* from enriched p where
      (p_view='review' and (p.status in ('active','waiting','on_hold') or p.needs_attention
        or exists(select 1 from public.project_actions a where a.project_id=p.id and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date>=p_today-((extract(isodow from p_today))::integer-1)))
       or p_view='all' or p_view='today' and (p.status in ('active','waiting','on_hold')
        or exists(select 1 from public.project_actions a where a.project_id=p.id and a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date=p_today))
       or p_view='active' and p.status='active'
       or p_view='waiting' and p.status in ('waiting','on_hold') or p_view='completed' and p.status in ('completed','dropped'))
    and (not p_attention or p.needs_attention)
    and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',p.title,p.outcome,p.theme,
      (select string_agg(a.content,' ' order by case a.status when 'next' then 0 when 'queued' then 1 when 'waiting' then 2 when 'done' then 3 else 4 end,
        case when a.status='queued' then a.sort_order end asc nulls last,
        case when a.status='queued' then a.created_at end asc,case when a.status='queued' then a.id end asc,a.updated_at desc,a.id desc)
        from public.project_actions a where a.project_id=p.id),
      (select string_agg(i.source_content,' ' order by i.updated_at desc,i.id desc) from public.project_items i where i.project_id=p.id))))>0)
), matching as (
  select * from context_matching where p_project_id is null
  union all select * from enriched where p_project_id is not null and id=p_project_id
), selected as (
  select * from matching order by
    case when p_sort='updated' then updated_at end desc,
    case when p_sort='target' then target_on end asc nulls last,
    case when p_sort='review' then review_on end asc nulls last,
    needs_attention desc,case when p_sort='recommended' then target_on end asc nulls last,updated_at desc,id desc
  limit case when p_view in ('review','today') then null else greatest(1,least(p_limit,100)) end offset greatest(p_offset,0)
), selected_actions as (
  select a.* from public.project_actions a join selected p on p.id=a.project_id where
    (p_project_id is null and (a.status='next' or p_view in ('review','today') and
      (a.status in ('queued','waiting') or a.status='done' and (a.completed_at at time zone 'Asia/Tokyo')::date >=
        case when p_view='today' then p_today else p_today-((extract(isodow from p_today))::integer-1) end)))
    or (p_project_id is not null and a.status in ('next','queued','waiting'))
  union all
  select h.* from selected p cross join lateral (
    select a.* from public.project_actions a where a.project_id=p.id and a.status in ('done','cancelled') and p_project_id is not null
    order by a.updated_at desc,a.id desc limit greatest(1,least(p_history_limit,100)) offset greatest(p_history_offset,0)
  ) h
), selected_items as (
  select i.* from selected p cross join lateral (
    select i.* from public.project_items i where i.project_id=p.id and p_project_id is not null
    order by i.updated_at desc,i.id desc limit 50 offset greatest(p_item_offset,0)
  ) i
), selected_milestones as (
  select m.* from public.project_milestones m join selected p on p.id=m.project_id
  where p_project_id is not null or exists(select 1 from selected_actions a where a.milestone_id=m.id)
), milestone_progress as (
  select a.milestone_id,count(*) filter(where a.status<>'cancelled') as total,
    count(*) filter(where a.status='done') as done from public.project_actions a
  join selected_milestones m on m.id=a.milestone_id group by a.milestone_id
)
select jsonb_build_object(
  'projects',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('context_matches',exists(select 1 from context_matching c where c.id=p.id))) from selected p),'[]'::jsonb),
  'actions',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('project_action_todos',
    (select jsonb_build_object('scheduled_action_id',l.scheduled_action_id) from public.project_action_todos l where l.project_action_id=a.id))) from selected_actions a),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.updated_at desc,i.id desc) from selected_items i),'[]'::jsonb),
  'milestones',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('total',coalesce(s.total,0),'done',coalesce(s.done,0))) from selected_milestones m left join milestone_progress s on s.milestone_id=m.id),'[]'::jsonb),
  'summary',(select jsonb_build_object('active',count(*) filter(where status='active'),'needsAttention',count(*) filter(where needs_attention),
    'stale',count(*) filter(where stale),'waiting',count(*) filter(where status in ('waiting','on_hold')),
    'completed',count(*) filter(where status='completed'),'openActions',coalesce(sum(open_count),0),'unprocessedItems',coalesce(sum(unprocessed),0),
    'reviewPending',count(*) filter(where status in ('active','waiting','on_hold') and target_on<p_today)
      +count(*) filter(where needs_attention)+count(*) filter(where stale)
      +count(*) filter(where status in ('waiting','on_hold') and review_on<=p_today)
      +(select count(*) from public.project_actions a join enriched p on p.id=a.project_id
        left join public.project_action_todos l on l.project_action_id=a.id left join public.scheduled_actions t on t.id=l.scheduled_action_id
        left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
        where p.status in ('active','waiting','on_hold') and a.status in ('next','queued')
          and coalesce(c.effective_date::text,t.current_schedule->>'date',a.due_on::text)<p_today::text)) from enriched),
  'reviewCalendarActions',coalesce((select jsonb_agg(jsonb_build_object('todoId',t.id,'projectId',a.project_id,
    'date',coalesce(c.effective_date::text,t.current_schedule->>'date'),
    'schedule',coalesce(c.schedule,t.current_schedule)||jsonb_build_object('date',coalesce(c.effective_date::text,t.current_schedule->>'date'))))
    from public.project_actions a join enriched p on p.id=a.project_id join public.project_action_todos l on l.project_action_id=a.id
    join public.scheduled_actions t on t.id=l.scheduled_action_id
    left join public.project_todo_read_cache c on c.scheduled_action_id=t.id and c.todo_updated_at=t.updated_at
    where p.status in ('active','waiting','on_hold') and a.status in ('next','queued')
      and (p_project_id is null or a.project_id=p_project_id)),'[]'::jsonb),
  'page',jsonb_build_object('view',p_view,'offset',p_offset,'total',(select count(*) from matching),
    'contextTotal',(select count(*) from context_matching),
    'hasMore',p_view not in ('review','today') and p_offset+(select count(*) from selected)<(select count(*) from matching),
    'historyOffset',p_history_offset,'historyHasMore',p_project_id is not null and p_history_offset+p_history_limit<coalesce((select history_count from selected limit 1),0),
    'itemOffset',p_item_offset,'itemsHasMore',p_project_id is not null and p_item_offset+50<coalesce((select item_count from selected limit 1),0))
);
$$;
revoke all on function public.get_project_read_model(text,text,integer,integer,bigint,integer,integer,integer,date,boolean,text) from public,anon,authenticated;
grant execute on function public.get_project_read_model(text,text,integer,integer,bigint,integer,integer,integer,date,boolean,text) to service_role;
create index if not exists project_actions_project_status_updated_idx on public.project_actions(project_id,status,updated_at desc,id desc);
create index if not exists project_items_project_updated_idx on public.project_items(project_id,updated_at desc,id desc);
$performance_source_20261026040133$]::text[]);
notify pgrst, 'reload schema';

commit;
